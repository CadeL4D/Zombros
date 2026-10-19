// First/third-person survivor controller (DESIGN.md §7, §14). Walks on the exact terrain mesh
// (World.groundHeight), collides with tree trunks, swims at the surface in deep water.
// The survivor is a capsule until character models land.
import { type World, palette, scale } from "@zombros/shared";
import * as THREE from "three/webgpu";
import type { InputFrame } from "../input/input";

export type ViewMode = "fp" | "tp";

const WALK = 4.5;
const SPRINT = 7.5;
const CROUCH = 2.0;
const SWIM = 2.2;
const GRAVITY = 20;
const JUMP = 6.3;
const EYE = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.3;
/** Steepest slope you can walk up (rise/run). */
const MAX_SLOPE = 1.3;
/** Water deeper than this and you swim. */
const SWIM_DEPTH = 1.3;

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  mode: ViewMode = "fp";
  crouching = false;
  grounded = false;
  swimming = false;
  sprinting = false;
  readonly body: THREE.Group;
  private eye = EYE;
  private bob = 0;
  private camDist = 3.6;

  constructor(private readonly world: World) {
    const color = palette.swatches.cloth_denim!.color;
    const h = scale.humanHeight;
    const capsule = new THREE.Mesh(
      new THREE.CapsuleGeometry(RADIUS, h - 2 * RADIUS, 4, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true }),
    );
    capsule.position.y = h / 2;
    // A visor so you can tell which way the capsule faces.
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.1, 0.12),
      new THREE.MeshStandardMaterial({ color: palette.swatches.cloth_black!.color, roughness: 0.6 }),
    );
    visor.position.set(0, h - 0.22, -RADIUS + 0.02);
    this.body = new THREE.Group();
    this.body.add(capsule, visor);
    this.body.traverse((o) => (o.castShadow = o.receiveShadow = true));
    this.body.visible = false;
  }

  spawn(x: number, z: number) {
    this.position.set(x, this.world.groundHeight(x, z), z);
    this.velocity.set(0, 0, 0);
  }

  update(dt: number, input: InputFrame) {
    const w = this.world;
    this.yaw -= input.lookX;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY, -1.5, 1.5);
    if (input.toggleView) this.mode = this.mode === "fp" ? "tp" : "fp";
    if (input.crouch && !this.swimming) this.crouching = !this.crouching;

    const moving = Math.hypot(input.moveX, input.moveY) > 0.05;
    this.sprinting = input.sprint && moving && !this.swimming;
    if (this.sprinting) this.crouching = false;

    const ground = w.groundHeight(this.position.x, this.position.z);
    const depth = w.config.seaLevel - ground;
    this.swimming = depth > SWIM_DEPTH && this.position.y <= w.config.seaLevel - SWIM_DEPTH + 0.05;
    if (this.swimming) this.crouching = false;

    // Wish direction in world space (yaw 0 looks down -z, north).
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wx = input.moveX * cos - input.moveY * sin;
    const wz = -input.moveX * sin - input.moveY * cos;
    const speed = this.swimming ? SWIM : this.crouching ? CROUCH : this.sprinting ? SPRINT : WALK;
    const accel = this.grounded || this.swimming ? 14 : 3;
    const k = 1 - Math.exp(-accel * dt);
    this.velocity.x += (wx * speed - this.velocity.x) * k;
    this.velocity.z += (wz * speed - this.velocity.z) * k;

    if (this.swimming) {
      // Float with the head above the surface.
      const target = w.config.seaLevel - SWIM_DEPTH;
      this.velocity.y = (target - this.position.y) * 4;
    } else {
      if (this.grounded && input.jump) {
        this.velocity.y = JUMP;
        this.grounded = false;
      }
      this.velocity.y -= GRAVITY * dt;
    }

    this.moveHorizontal(dt);
    this.position.y += this.velocity.y * dt;

    const g = w.groundHeight(this.position.x, this.position.z);
    const snap = this.grounded && this.velocity.y <= 0 && this.position.y - g < 0.4;
    if (this.position.y <= g || snap) {
      this.position.y = g;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    if (this.swimming) this.grounded = false;

    const targetEye = this.crouching ? EYE_CROUCH : EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-12 * dt));
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && hSpeed > 0.5) this.bob += dt * hSpeed * 1.9;
  }

  /** Move with slope limits and tree collisions; try each axis alone if the full move is blocked. */
  private moveHorizontal(dt: number) {
    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;
    if (!this.tryMove(dx, dz)) {
      if (!this.tryMove(dx, 0)) this.velocity.x = 0;
      if (!this.tryMove(0, dz)) this.velocity.z = 0;
    }
    this.collideTrees();
    const lim = this.world.config.size / 2 - 20;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -lim, lim);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -lim, lim);
  }

  private tryMove(dx: number, dz: number) {
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return true;
    const w = this.world;
    const nx = this.position.x + dx;
    const nz = this.position.z + dz;
    if (this.grounded && !this.swimming) {
      const rise = w.groundHeight(nx, nz) - w.groundHeight(this.position.x, this.position.z);
      if (rise / dist > MAX_SLOPE) return false;
    }
    this.position.x = nx;
    this.position.z = nz;
    return true;
  }

  private collideTrees() {
    const w = this.world;
    const c = w.config.trees.cell;
    const ci = Math.floor(this.position.x / c);
    const cj = Math.floor(this.position.z / c);
    for (let j = cj - 1; j <= cj + 1; j++) {
      for (let i = ci - 1; i <= ci + 1; i++) {
        const t = w.treeInCell(i, j);
        if (!t || this.position.y > t.y + 4 * t.scale) continue;
        const r = w.config.trees.radius * t.scale + RADIUS;
        const ox = this.position.x - t.x;
        const oz = this.position.z - t.z;
        const d = Math.hypot(ox, oz);
        if (d < r && d > 1e-4) {
          this.position.x = t.x + (ox / d) * r;
          this.position.z = t.z + (oz / d) * r;
        }
      }
    }
  }

  /** Place the camera for the current view mode. */
  applyCamera(camera: THREE.PerspectiveCamera) {
    camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    const bob = this.mode === "fp" && this.grounded ? Math.sin(this.bob) * 0.035 : 0;
    const head = new THREE.Vector3(this.position.x, this.position.y + this.eye + bob, this.position.z);
    this.body.visible = this.mode === "tp";
    this.body.position.copy(this.position);
    this.body.rotation.y = this.yaw;
    this.body.scale.y = this.eye / EYE;
    if (this.mode === "fp") {
      camera.position.copy(head);
      return;
    }
    // Over-the-shoulder: back along the view direction, a little to the right; pull in before terrain.
    const back = new THREE.Vector3(0, 0, 1).applyEuler(camera.rotation);
    const right = new THREE.Vector3(1, 0, 0).applyEuler(camera.rotation);
    const pivot = head.clone().addScaledVector(right, 0.45);
    let dist = 3.6;
    for (let s = 1; s <= 8; s++) {
      const d = (3.6 * s) / 8;
      const p = pivot.clone().addScaledVector(back, d);
      if (p.y < this.world.groundHeight(p.x, p.z) + 0.3) {
        dist = Math.max(0.6, d - 0.45);
        break;
      }
    }
    this.camDist = dist < this.camDist ? dist : this.camDist + (dist - this.camDist) * 0.15;
    camera.position.copy(pivot).addScaledVector(back, this.camDist);
  }
}
