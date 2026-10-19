// Character stand-ins: survivors and zombies are coloured capsules at human height until real
// character models land (DESIGN.md §17, "Later"). Lined up on the 1 m build grid next to a wall module.
import { palette, scale } from "@zombros/shared";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#6f7d86");
scene.fog = new THREE.Fog("#6f7d86", 18, 50);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 2.0, 9.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.update();

scene.add(new THREE.HemisphereLight("#cfe3ff", "#4a4136", 1.3));
const sun = new THREE.DirectionalLight("#fff1dc", 2.4);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 5, bottom: -3 });
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: "#4f5546", roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(20, 20 / scale.buildGrid, "#2c3322", "#3d4434");
grid.position.y = 0.002;
scene.add(grid);
const wall = new THREE.Mesh(
  new THREE.BoxGeometry(scale.wall.width, scale.wall.height, scale.wall.thickness),
  new THREE.MeshStandardMaterial({ color: palette.swatches.brick!.color, roughness: 0.9 }),
);
wall.position.set(-1, scale.wall.height / 2, -2);
wall.castShadow = wall.receiveShadow = true;
scene.add(wall);

/** One capsule per character, coloured by palette swatch. */
const CHARACTERS = [
  { id: "survivor_1", kind: "survivor", swatch: "cloth_denim" },
  { id: "survivor_2", kind: "survivor", swatch: "cloth_red" },
  { id: "survivor_3", kind: "survivor", swatch: "cloth_yellow" },
  { id: "survivor_4", kind: "survivor", swatch: "cloth_orange" },
  { id: "zombie_1", kind: "zombie", swatch: "zombie_skin_1" },
  { id: "zombie_2", kind: "zombie", swatch: "zombie_skin_2" },
  { id: "zombie_3", kind: "zombie", swatch: "zombie_skin_3" },
  { id: "zombie_4", kind: "zombie", swatch: "blood_dry" },
] as const;

const radius = 0.3;
// CapsuleGeometry's length is the straight middle part; the caps add a radius at each end.
const capsule = new THREE.CapsuleGeometry(radius, scale.humanHeight - 2 * radius, 4, 12);
const spacing = 0.95;
CHARACTERS.forEach((c, i) => {
  const mesh = new THREE.Mesh(
    capsule,
    new THREE.MeshStandardMaterial({ color: palette.swatches[c.swatch]!.color, roughness: 0.8, flatShading: true }),
  );
  mesh.name = c.id;
  mesh.position.set((i - (CHARACTERS.length - 1) / 2) * spacing, scale.humanHeight / 2, 0);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
});

const panel = document.getElementById("panel")!;
const stats = document.createElement("div");
stats.id = "stats";
panel.appendChild(stats);

async function main() {
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2";
  const zombies = CHARACTERS.filter((c) => c.kind === "zombie").length;
  stats.textContent = `${CHARACTERS.length - zombies} survivors · ${zombies} zombies (capsules) · ${backend}`;
}

renderer.setAnimationLoop(() => {
  if (!innerWidth || !innerHeight) return; // hidden tab/pane: nothing to draw into
  renderer.render(scene, camera);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
});

main().catch((e) => {
  console.error(e);
  panel.append(` — failed to start: ${e}`);
});
