// Terrain meshing off the main thread (DESIGN.md §16).
import { createWorld, type World } from "@zombros/shared";
import { buildNode, type NodeRequest } from "./nodeMesh";

let world: World | null = null;

self.onmessage = (e: MessageEvent<{ seed: number } | NodeRequest>) => {
  const msg = e.data;
  if ("seed" in msg) {
    world = createWorld(msg.seed);
    return;
  }
  const r = buildNode(world!, msg);
  (self as unknown as Worker).postMessage(r, [r.positions.buffer, r.normals.buffer, r.colors.buffer, r.pines.buffer, r.broadleaves.buffer]);
};
