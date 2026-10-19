// Day/night cycle (DESIGN.md §3 lighting): gradient sky dome, sun and moon sharing one shadowed
// directional light, hemisphere ambient, stars, and fog that always matches the horizon.
import type { WorldConfig } from "@zombros/shared";
import * as THREE from "three/webgpu";
import { dot, max, mix, normalize, positionLocal, pow, smoothstep, uniform } from "three/tsl";

/** Sky keyframes by sun elevation (sin of altitude). */
const KEYS: { e: number; zenith: string; horizon: string; sun: string; ambient: string }[] = [
  { e: -1.0, zenith: "#03050c", horizon: "#0a0f1c", sun: "#9fb4ff", ambient: "#56689c" },
  { e: -0.25, zenith: "#05081a", horizon: "#121a2e", sun: "#9fb4ff", ambient: "#56689c" },
  { e: -0.08, zenith: "#141d40", horizon: "#3a3450", sun: "#ff8a50", ambient: "#6a6a98" },
  { e: 0.0, zenith: "#2e3f74", horizon: "#d77a4e", sun: "#ff9a5a", ambient: "#a89098" },
  { e: 0.1, zenith: "#4870ad", horizon: "#eab07c", sun: "#ffc890", ambient: "#a8b4c8" },
  { e: 0.3, zenith: "#4a82c4", horizon: "#b4d0e6", sun: "#fff1dc", ambient: "#c4d8f0" },
  { e: 1.0, zenith: "#3a72b8", horizon: "#a8c8e4", sun: "#fff6e8", ambient: "#cfe3ff" },
];
const KEY_COLORS = KEYS.map((k) => ({
  e: k.e,
  zenith: new THREE.Color(k.zenith),
  horizon: new THREE.Color(k.horizon),
  sun: new THREE.Color(k.sun),
  ambient: new THREE.Color(k.ambient),
}));

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface SkyOptions {
  radius: number;
  shadowMap: number;
  shadowExtent: number;
}

export class DayNight {
  /** Hours since the world started (Day 1, startHour). */
  hours: number;
  /** Game hours per real second. */
  rate: number;
  speedup = 1;

  readonly sun = new THREE.DirectionalLight("#ffffff", 3);
  readonly hemi = new THREE.HemisphereLight("#cfe3ff", "#3d3a30", 1);
  readonly fog: THREE.Fog;
  private readonly dome: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly moon: THREE.Mesh;
  private readonly uZenith = uniform(new THREE.Color());
  private readonly uHorizon = uniform(new THREE.Color());
  private readonly uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  private readonly uSunColor = uniform(new THREE.Color());
  private readonly sunDir = new THREE.Vector3();
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly tmp = { zenith: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), ambient: new THREE.Color() };

  constructor(
    scene: THREE.Scene,
    config: WorldConfig["day"],
    private readonly opts: SkyOptions,
    fogNear: number,
  ) {
    this.hours = config.startHour;
    this.rate = 24 / (config.lengthMinutes * 60);

    // Dome: horizon -> zenith gradient plus a sun disc and glow; below the horizon it fades to the fog colour.
    const dir = normalize(positionLocal);
    const up = max(dir.y, 0);
    const sky = mix(this.uHorizon, this.uZenith, pow(up, 0.55));
    const below = smoothstep(-0.12, 0.0, dir.y);
    const s = max(dot(dir, this.uSunDir), 0);
    const sunGlow = this.uSunColor.mul(pow(s, 900).mul(6).add(pow(s, 12).mul(0.35)));
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    mat.colorNode = mix(this.uHorizon, sky.add(sunGlow.mul(below)), below);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(opts.radius, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -2;
    scene.add(this.dome);

    const starPos: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPos.push(Math.cos(a) * r * opts.radius * 0.95, Math.abs(u) * opts.radius * 0.95, Math.sin(a) * r * opts.radius * 0.95);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    this.starMaterial = new THREE.PointsMaterial({ color: "#ffffff", size: 1, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
    this.stars = new THREE.Points(starGeo, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    scene.add(this.stars);

    this.moon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(opts.radius * 0.025, 1),
      new THREE.MeshBasicMaterial({ color: "#e4e9f4", fog: false, depthWrite: false }),
    );
    this.moon.renderOrder = -1;
    scene.add(this.moon);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(opts.shadowMap, opts.shadowMap);
    const e = opts.shadowExtent;
    Object.assign(this.sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 600 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.fog = new THREE.Fog("#a8c8e4", fogNear, opts.radius);
    scene.fog = this.fog;
  }

  get day() {
    return Math.floor(this.hours / 24) + 1;
  }

  get clock() {
    const h = this.hours % 24;
    const m = Math.floor((h % 1) * 60);
    return `${String(Math.floor(h)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /** Sun elevation: 1 = straight up, < 0 = night. */
  get elevation() {
    return this.sunDir.y;
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3) {
    this.hours += dt * this.rate * this.speedup;
    // Sun rises in the east (+x), sets in the west, and arcs through the south (+z).
    const a = ((this.hours % 24) - 6) / 24 * Math.PI * 2;
    const tilt = 0.45;
    this.sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
    const e = this.sunDir.y;

    // Interpolate keyframes.
    let i = 0;
    while (i < KEY_COLORS.length - 2 && e > KEY_COLORS[i + 1]!.e) i++;
    const k0 = KEY_COLORS[i]!;
    const k1 = KEY_COLORS[i + 1]!;
    const t = Math.min(1, Math.max(0, (e - k0.e) / (k1.e - k0.e)));
    const c = this.tmp;
    c.zenith.lerpColors(k0.zenith, k1.zenith, t);
    c.horizon.lerpColors(k0.horizon, k1.horizon, t);
    c.sun.lerpColors(k0.sun, k1.sun, t);
    c.ambient.lerpColors(k0.ambient, k1.ambient, t);

    this.uZenith.value.copy(c.zenith);
    this.uHorizon.value.copy(c.horizon);
    this.uSunDir.value.copy(this.sunDir);
    this.uSunColor.value.copy(c.sun).multiplyScalar(smooth(-0.1, 0.02, e));
    this.fog.color.copy(c.horizon);

    // One shadowed light: the sun by day, the moon (opposite the sun) by night.
    const day = smooth(-0.04, 0.2, e);
    const night = smooth(0.04, 0.3, -e);
    const useSun = e > -0.04;
    const lightDir = useSun ? this.sunDir : this.sunDir.clone().negate();
    this.sun.color.copy(c.sun);
    this.sun.intensity = useSun ? 2.4 * day : 0.6 * night;
    this.hemi.color.copy(c.ambient);
    this.hemi.groundColor.set("#3d3a30").multiplyScalar(0.3 + 0.7 * day);
    this.hemi.intensity = 2.0 - 0.9 * day;

    // Keep the shadow box centred on the player, snapped to shadow texels to avoid shimmering.
    const texel = (2 * this.opts.shadowExtent) / this.opts.shadowMap;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + lightDir.x * 300, focus.y + lightDir.y * 300, fz + lightDir.z * 300);

    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.stars.rotation.y = (this.hours / 24) * Math.PI * 2 * 0.1;
    this.starMaterial.opacity = smooth(0.0, 0.25, -e);
    this.stars.visible = this.starMaterial.opacity > 0.01;
    this.moon.position.copy(camera.position).addScaledVector(this.sunDir, -this.opts.radius * 0.9);
    this.moon.visible = -e > -0.1;
  }
}
