// M1 "Walk the world": streamed terrain, FP/TP survivor, day/night, PC + gamepad + phone controls.
// ?seed=123 picks the world, ?quality=low|high overrides the device tier, ?debug opens the debug panel.
import { createWorld, palette, worldConfig } from "@zombros/shared";
import * as THREE from "three/webgpu";
import { Input } from "./input/input";
import { Player } from "./player/player";
import { pickQuality } from "./quality";
import { installErrorOverlay, showError } from "./ui/errors";
import { Hud } from "./ui/hud";
import { DayNight } from "./world/sky";
import { Terrain } from "./world/terrain";

installErrorOverlay();

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed") ?? worldConfig.seed) | 0;
const quality = pickQuality();
const world = createWorld(seed);

const renderer = new THREE.WebGPURenderer({ antialias: quality.antialias });
renderer.setPixelRatio(quality.pixelRatio);
renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const far = quality.viewDistance * 1.25;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, far);

const sky = new DayNight(scene, worldConfig.day, { radius: quality.viewDistance * 1.1, shadowMap: quality.shadowMap, shadowExtent: quality.shadowExtent }, quality.viewDistance * 0.3);
const terrain = new Terrain(world, { lodFactor: quality.lodFactor, viewDistance: quality.viewDistance, treeNodeMax: quality.treeNodeMax, coarseSegments: quality.coarseSegments, workers: quality.workers, cache: quality.terrainCache, onError: showError });
scene.add(terrain.group);

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(far * 2, far * 2),
  new THREE.MeshStandardMaterial({ color: palette.swatches.water!.color, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.82 }),
);
water.rotation.x = -Math.PI / 2;
water.position.y = worldConfig.seaLevel;
water.receiveShadow = true;
scene.add(water);

const player = new Player(world);
scene.add(player.body);
const spawn = world.findSpawn();
player.spawn(spawn.x, spawn.z);

const ui = document.getElementById("ui")!;
const hud = new Hud(ui);
const input = new Input(renderer.domElement, document.getElementById("touch")!);
hud.setLoading(true);

// Desktop: click to lock the mouse; the start card shows whenever it's unlocked.
const syncStart = () => hud.setStart(!input.keyboard.locked && !input.touch.enabled && input.active !== "gamepad");
hud.start.addEventListener("click", () => input.keyboard.lock());
renderer.domElement.addEventListener("click", () => {
  if (!input.touch.enabled) input.keyboard.lock();
});
document.addEventListener("pointerlockchange", syncStart);

let backend = "";
let loaded = false;
let last = performance.now();
let fps = 0;

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (!innerWidth || !innerHeight) return; // hidden tab/pane: nothing to draw into

  const kb = input.keyboard;
  if (kb.consume("KeyH")) hud.toggleHelp();
  if (kb.consume("F3")) hud.showDebug = !hud.showDebug;
  if (kb.consume("KeyT")) sky.speedup = sky.speedup === 1 ? 60 : 1;
  if (kb.consume("BracketRight")) sky.hours += 1;
  if (kb.consume("BracketLeft")) sky.hours = Math.max(0, sky.hours - 1);

  terrain.update(player.position.x, player.position.z);
  if (!loaded && terrain.ready) {
    loaded = true;
    hud.setLoading(false);
  }
  const f = input.poll(dt);
  // Wait for the ground under you before simulating, and don't walk while the start card is up.
  const playing = loaded && (kb.locked || input.touch.enabled || input.active === "gamepad");
  if (loaded) player.update(dt, playing ? f : { ...f, moveX: 0, moveY: 0, lookX: 0, lookY: 0, jump: false, crouch: false, toggleView: false, sprint: false });
  syncStart();
  player.applyCamera(camera);
  water.position.x = Math.round(camera.position.x / 50) * 50;
  water.position.z = Math.round(camera.position.z / 50) * 50;
  sky.update(dt, camera, player.position);

  // Render first: renderer.info is reset at the start of each frame.
  renderer.render(scene, camera);
  hud.update(player.yaw, sky.day, sky.clock, () => {
    const p = player.position;
    const info = renderer.info.render;
    return [
      `${fps.toFixed(0)} fps · ${backend} · quality ${quality.name} · seed ${seed}`,
      `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · ${player.mode.toUpperCase()}${player.swimming ? " · swimming" : player.crouching ? " · crouch" : player.sprinting ? " · sprint" : ""}`,
      `terrain ${terrain.stats.visible} nodes · ${terrain.stats.pending} pending · ${terrain.stats.cached} cached · ${(terrain.stats.tris / 1000).toFixed(0)}k tris`,
      `frame ${(info.triangles / 1000).toFixed(0)}k tris · ${info.drawCalls} draws`,
      `input ${input.active}${input.gamepad.name ? ` (${input.gamepad.name.slice(0, 32)})` : ""} · time x${sky.speedup}`,
    ].join("\n");
  });
}

// Dev hook: step frames and poke state from the console (also works when rAF is throttled).
if (import.meta.env.DEV) Object.assign(window, { zombros: { frame, player, sky, terrain, world, camera, input } });

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
});

renderer
  .init()
  .then(() => {
    backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2";
    renderer.setAnimationLoop(frame);
  })
  .catch((e) => {
    console.error(e);
    showError(`Failed to start: ${e}`);
  });
