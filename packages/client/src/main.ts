// Character viewer: loads every character in the manifest, lines them up on the 1 m build
// grid and plays their baked clips (survivors: idle/walk/run, zombies: idle/shamble/attack).
import { type Manifest, type ManifestEntry, palette, scale, validateManifest } from "@zombros/shared";
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const asset = (path: string) => import.meta.env.BASE_URL + path;

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

const panel = document.getElementById("panel")!;

/** Clip per mode, by character kind (tag). */
const MODES = {
  idle: { survivor: "idle", zombie: "zombie_idle" },
  move: { survivor: "walk", zombie: "shamble" },
  action: { survivor: "run", zombie: "zombie_attack" },
} as const;
type Mode = keyof typeof MODES;

interface Character {
  entry: ManifestEntry;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  action?: THREE.AnimationAction;
}

const characters: Character[] = [];
const clock = new THREE.Clock();

function kindOf(e: ManifestEntry): "survivor" | "zombie" {
  return e.tags.includes("zombie") ? "zombie" : "survivor";
}

function play(c: Character, mode: Mode) {
  const clip = c.clips.get(MODES[mode][kindOf(c.entry)]);
  if (!clip) return;
  const next = c.mixer.clipAction(clip);
  next.reset().setEffectiveWeight(1).play();
  // Offset each character a little so a crowd doesn't move in lockstep.
  next.time = (characters.indexOf(c) * 0.37) % clip.duration;
  if (c.action && c.action !== next) c.action.crossFadeTo(next, 0.25, false);
  c.action = next;
}

function button(label: string, onClick: () => void) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

async function load(entry: ManifestEntry, loader: GLTFLoader): Promise<Character> {
  const gltf = await loader.loadAsync(asset(entry.file));
  const root = gltf.scene;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.map) {
      mat.map.magFilter = THREE.NearestFilter;
      mat.map.minFilter = THREE.NearestFilter;
      mat.map.generateMipmaps = false;
    }
  });
  return {
    entry,
    root,
    mixer: new THREE.AnimationMixer(root),
    clips: new Map(gltf.animations.map((a) => [a.name, a])),
  };
}

async function main() {
  await renderer.init();
  const manifest: Manifest = await (await fetch(asset("manifest.json"))).json();
  const errors = validateManifest(manifest);
  if (errors.length) console.warn("manifest:", errors);

  const entries = manifest.assets
    .filter((a) => a.kind === "character" && a.tags.includes("generated"))
    .sort((a, b) => kindOf(a).localeCompare(kindOf(b)) || a.id.localeCompare(b.id));
  const loader = new GLTFLoader();
  const loaded = await Promise.all(entries.map((e) => load(e, loader)));

  const spacing = 0.95;
  loaded.forEach((c, i) => {
    c.root.position.x = (i - (loaded.length - 1) / 2) * spacing;
    scene.add(c.root);
    characters.push(c);
    play(c, "idle");
  });

  const modes = document.createElement("div");
  modes.className = "modes";
  for (const [mode, label] of [["idle", "Idle"], ["move", "Walk / shamble"], ["action", "Run / attack"]] as const) {
    modes.appendChild(button(label, () => characters.forEach((c) => play(c, mode))));
  }
  panel.appendChild(modes);

  const helpers = characters.map((c) => {
    const h = new THREE.SkeletonHelper(c.root);
    h.visible = false;
    scene.add(h);
    return h;
  });
  const row = document.createElement("label");
  row.textContent = "show bones";
  const box = Object.assign(document.createElement("input"), { type: "checkbox" });
  box.addEventListener("change", () => helpers.forEach((h) => (h.visible = box.checked)));
  row.appendChild(box);
  panel.appendChild(row);

  const stats = document.createElement("div");
  stats.id = "stats";
  const tris = characters.map((c) => Object.values(c.entry.tris).reduce((a, b) => a + b, 0));
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2";
  stats.textContent = `${characters.length} characters · ${Math.min(...tris)}–${Math.max(...tris)} tris each · ${backend}`;
  panel.appendChild(stats);
}

renderer.setAnimationLoop(() => {
  if (!innerWidth || !innerHeight) return; // hidden tab/pane: nothing to draw into
  const dt = clock.getDelta();
  for (const c of characters) c.mixer.update(dt);
  renderer.render(scene, camera);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
});

main().catch((e) => {
  console.error(e);
  panel.append(` — failed to load: ${e}`);
});
