// M0 viewer: loads the base human from the manifest and exercises the contracts
// (morphs, palette swatch swap, skeleton) on a 1 m build grid.
import { type Manifest, palette, scale, validateManifest } from "@zombros/shared";
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PaletteTexture } from "./palette";

const asset = (path: string) => import.meta.env.BASE_URL + path;

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#8fa3b0");
scene.fog = new THREE.Fog("#8fa3b0", 15, 45);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200);
camera.position.set(2.2, 1.6, 3.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.update();

scene.add(new THREE.HemisphereLight("#cfe3ff", "#5a4e3c", 1.2));
const sun = new THREE.DirectionalLight("#fff1dc", 2.6);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
scene.add(sun);

// Ground with the 1 m build grid, plus one wall module from the scale contract for reference.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: "#6b7a52", roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(20, 20 / scale.buildGrid, "#2c3322", "#4b5638");
grid.position.y = 0.002;
scene.add(grid);
const wall = new THREE.Mesh(
  new THREE.BoxGeometry(scale.wall.width, scale.wall.height, scale.wall.thickness),
  new THREE.MeshStandardMaterial({ color: palette.swatches.brick!.color, roughness: 0.9 }),
);
wall.position.set(-2, scale.wall.height / 2, -1);
wall.castShadow = wall.receiveShadow = true;
scene.add(wall);

const panel = document.getElementById("panel")!;

function slider(label: string, min: number, max: number, value: number, onInput: (v: number) => void) {
  const row = document.createElement("label");
  row.textContent = label;
  const input = Object.assign(document.createElement("input"), { type: "range", min, max, step: 0.01, value });
  input.addEventListener("input", () => onInput(Number(input.value)));
  row.appendChild(input);
  panel.appendChild(row);
}

function checkbox(label: string, onChange: (on: boolean) => void) {
  const row = document.createElement("label");
  row.textContent = label;
  const input = Object.assign(document.createElement("input"), { type: "checkbox" });
  input.addEventListener("change", () => onChange(input.checked));
  row.appendChild(input);
  panel.appendChild(row);
}

let walking = false;
const clock = new THREE.Clock();
let tick: (t: number) => void = () => {};

async function main() {
  await renderer.init();
  const manifest: Manifest = await (await fetch(asset("manifest.json"))).json();
  const errors = validateManifest(manifest);
  if (errors.length) console.warn("manifest:", errors);
  const entry = manifest.assets.find((a) => a.id === "human_base");
  if (!entry) throw new Error("human_base missing from manifest");

  const gltf = await new GLTFLoader().loadAsync(asset(entry.file));
  const human = gltf.scene;
  scene.add(human);

  const skinned: THREE.SkinnedMesh[] = [];
  human.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
      const m = o as THREE.SkinnedMesh;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      skinned.push(m);
    }
  });

  // One palette texture per character, so recolours don't leak to other characters.
  const firstMat = skinned[0]!.material as THREE.MeshStandardMaterial;
  const pal = await PaletteTexture.fromImage(firstMat.map!.image as CanvasImageSource);
  for (const m of skinned) {
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.map = pal.texture;
    mat.flatShading = true;
    m.material = mat;
  }

  for (const morph of entry.morphs ?? []) {
    slider(morph, 0, 1, 0, (v) => {
      for (const m of skinned) {
        const i = m.morphTargetDictionary?.[morph];
        if (i !== undefined) m.morphTargetInfluences![i] = v;
      }
    });
  }
  slider("height", 0.9, 1.1, 1, (v) => human.scale.setScalar(v));

  const skins = Object.keys(palette.swatches).filter((k) => k.startsWith("skin_"));
  const row = document.createElement("div");
  row.className = "swatches";
  for (const name of skins) {
    const b = document.createElement("button");
    b.title = name;
    b.style.background = palette.swatches[name]!.color;
    b.classList.toggle("on", name === "skin_2");
    b.onclick = () => {
      pal.recolor("skin_2", palette.swatches[name]!.color);
      row.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    };
    row.appendChild(b);
  }
  panel.appendChild(row);

  const helper = new THREE.SkeletonHelper(human);
  helper.visible = false;
  scene.add(helper);
  checkbox("show bones", (on) => (helper.visible = on));
  checkbox("walk test", (on) => (walking = on));

  // Procedural walk swing on the bones' local X, applied on top of the rest pose.
  const bones = new Map<string, { bone: THREE.Object3D; rest: THREE.Quaternion }>();
  human.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, { bone: o, rest: o.quaternion.clone() });
  });
  const q = new THREE.Quaternion();
  const x = new THREE.Vector3(1, 0, 0);
  const swing = (name: string, angle: number) => {
    const b = bones.get(name);
    if (b) b.bone.quaternion.copy(b.rest).multiply(q.setFromAxisAngle(x, angle));
  };
  tick = (t) => {
    const s = walking ? Math.sin(t * 6) : 0;
    swing("thigh_L", -0.5 * s);
    swing("thigh_R", 0.5 * s);
    swing("shin_L", walking ? 0.6 * Math.max(0, Math.sin(t * 6 + 1.6)) : 0);
    swing("shin_R", walking ? 0.6 * Math.max(0, -Math.sin(t * 6 + 1.6)) : 0);
    swing("upperarm_L", 0.4 * s);
    swing("upperarm_R", -0.4 * s);
    swing("forearm_L", walking ? -0.3 : 0);
    swing("forearm_R", walking ? -0.3 : 0);
  };

  const stats = document.createElement("div");
  stats.id = "stats";
  const tris = Object.entries(entry.tris).map(([k, v]) => `${k} ${v}`).join(" · ");
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2";
  stats.textContent = `${tris} tris · ${backend}`;
  panel.appendChild(stats);
}

renderer.setAnimationLoop(() => {
  if (!innerWidth || !innerHeight) return; // hidden tab/pane: nothing to draw into
  tick(clock.getElapsedTime());
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
