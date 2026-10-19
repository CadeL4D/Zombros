// Streamed terrain (DESIGN.md §3a "quadtree LOD", §4): the map is a quadtree whose leaves near the
// player are fine (2 m faces) and whose far nodes cover kilometres with the same triangle count.
// Nodes are meshed in a worker pool, cached, and swapped without holes: until every leaf under a
// coarse node is ready, the coarse node keeps drawing.
import type { World } from "@zombros/shared";
import * as THREE from "three/webgpu";
import type { NodeRequest, NodeResult } from "./nodeMesh";
import { treeGeometries } from "./trees";

export interface TerrainOptions {
  /** Split a node while the player is closer than `lodFactor` x its size. */
  lodFactor: number;
  /** Nodes further than this are not drawn (matches fog far). */
  viewDistance: number;
  /** Trees are drawn only on nodes this size or smaller. */
  treeNodeMax: number;
  /** Faces per side for nodes coarser than leaves (leaves always use the world setting). */
  coarseSegments: number;
  workers: number;
  /** Built nodes kept around for when you walk back (each is ~0.25 MB). */
  cache: number;
  onError?: (message: string) => void;
}

interface Node {
  key: string;
  level: number;
  ix: number;
  iz: number;
  dist: number;
  object?: THREE.Group;
  pending: boolean;
  used: number;
}

const key = (level: number, ix: number, iz: number) => `${level}:${ix}:${iz}`;

export class Terrain {
  readonly group = new THREE.Group();
  readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  private readonly treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  private readonly trees = treeGeometries();
  private readonly nodes = new Map<string, Node>();
  private readonly byId = new Map<number, Node>();
  private readonly workers: Worker[] = [];
  private readonly busy: number[] = [];
  private queue: Node[] = [];
  private nextId = 1;
  private frame = 0;
  private readonly maxLevel: number;
  private lastX = Infinity;
  private lastZ = Infinity;
  private desired: Node[] = [];
  private wantX = 0;
  private wantZ = 0;

  stats = { visible: 0, pending: 0, cached: 0, tris: 0 };

  constructor(
    private readonly world: World,
    private readonly opts: TerrainOptions,
  ) {
    this.maxLevel = Math.round(Math.log2(world.config.size / world.config.terrain.leafSize));
    for (let i = 0; i < opts.workers; i++) {
      const w = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
      w.postMessage({ seed: world.seed });
      w.onmessage = (e: MessageEvent<NodeResult>) => this.onBuilt(i, e.data);
      w.onerror = (e) => opts.onError?.(`terrain worker: ${e.message || "failed to load"}`);
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  /** True once every node wanted around the player is built. */
  get ready() {
    const fresh = Math.hypot(this.wantX - this.lastX, this.wantZ - this.lastZ) <= 4;
    return fresh && this.desired.length > 0 && this.desired.every((n) => n.object);
  }

  update(px: number, pz: number) {
    this.frame++;
    this.wantX = px;
    this.wantZ = pz;
    if (Math.hypot(px - this.lastX, pz - this.lastZ) > 4) {
      this.lastX = px;
      this.lastZ = pz;
      this.select(px, pz);
    }
    this.pump();
  }

  private node(level: number, ix: number, iz: number) {
    const k = key(level, ix, iz);
    let n = this.nodes.get(k);
    if (!n) this.nodes.set(k, (n = { key: k, level, ix, iz, dist: 0, pending: false, used: 0 }));
    return n;
  }

  /** Pick the leaf set for this position and decide what to draw. */
  private select(px: number, pz: number) {
    const half = this.world.config.size / 2;
    const leaves: Node[] = [];
    const visit = (level: number, ix: number, iz: number) => {
      const size = this.world.config.size / 2 ** level;
      const x0 = -half + ix * size;
      const z0 = -half + iz * size;
      const dx = Math.max(x0 - px, 0, px - (x0 + size));
      const dz = Math.max(z0 - pz, 0, pz - (z0 + size));
      const dist = Math.hypot(dx, dz);
      if (dist > this.opts.viewDistance) return;
      if (level < this.maxLevel && dist < size * this.opts.lodFactor) {
        for (let k = 0; k < 4; k++) visit(level + 1, ix * 2 + (k & 1), iz * 2 + (k >> 1));
        return;
      }
      const n = this.node(level, ix, iz);
      n.dist = dist;
      leaves.push(n);
    };
    visit(0, 0, 0);
    this.desired = leaves;

    // What to draw: a built leaf, else its nearest built ancestor, else whatever built children it has.
    const show = new Set<Node>();
    const ancestorOf = (n: Node): Node | undefined => {
      for (let l = n.level - 1, ix = n.ix >> 1, iz = n.iz >> 1; l >= 0; l--, ix >>= 1, iz >>= 1) {
        const a = this.nodes.get(key(l, ix, iz));
        if (a?.object) return a;
      }
    };
    const builtBelow = (level: number, ix: number, iz: number, depth: number) => {
      if (depth === 0 || level >= this.maxLevel) return;
      for (let k = 0; k < 4; k++) {
        const cx = ix * 2 + (k & 1);
        const cz = iz * 2 + (k >> 1);
        const c = this.nodes.get(key(level + 1, cx, cz));
        if (c?.object) show.add(c);
        else builtBelow(level + 1, cx, cz, depth - 1);
      }
    };
    for (const n of leaves) {
      if (n.object) show.add(n);
      else {
        const a = ancestorOf(n);
        if (a) show.add(a);
        else builtBelow(n.level, n.ix, n.iz, 3);
      }
    }
    // An ancestor drawing covers its whole area, so drop anything under it.
    for (const n of show) {
      for (let l = n.level - 1, ix = n.ix >> 1, iz = n.iz >> 1; l >= 0; l--, ix >>= 1, iz >>= 1) {
        const a = this.nodes.get(key(l, ix, iz));
        if (a && show.has(a)) {
          show.delete(n);
          break;
        }
      }
    }

    let tris = 0;
    for (const n of this.nodes.values()) {
      if (!n.object) continue;
      const on = show.has(n);
      n.object.visible = on;
      if (on) {
        n.used = this.frame;
        tris += n.object.userData.tris as number;
      }
    }

    this.queue = leaves.filter((n) => !n.object && !n.pending).sort((a, b) => a.dist - b.dist);
    this.evict(show);
    this.stats = { visible: show.size, pending: this.queue.length + this.busy.reduce((a, b) => a + b, 0), cached: this.byKeyBuilt(), tris };
  }

  private byKeyBuilt() {
    let c = 0;
    for (const n of this.nodes.values()) if (n.object) c++;
    return c;
  }

  private pump() {
    for (let i = 0; i < this.workers.length && this.queue.length; i++) {
      while (this.busy[i]! < 2 && this.queue.length) {
        const n = this.queue.shift()!;
        const size = this.world.config.size / 2 ** n.level;
        const id = this.nextId++;
        n.pending = true;
        this.byId.set(id, n);
        const req: NodeRequest = { id, level: n.level, ix: n.ix, iz: n.iz, trees: size <= this.opts.treeNodeMax, segments: n.level === this.maxLevel ? this.world.config.terrain.segments : this.opts.coarseSegments };
        this.workers[i]!.postMessage(req);
        this.busy[i]!++;
      }
    }
  }

  private onBuilt(worker: number, r: NodeResult) {
    this.busy[worker]!--;
    const n = this.byId.get(r.id);
    this.byId.delete(r.id);
    if (!n || !this.nodes.has(n.key)) return;
    n.pending = false;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(r.colors, 3));
    geo.computeBoundingSphere();
    const ground = new THREE.Mesh(geo, this.material);
    ground.castShadow = ground.receiveShadow = true;

    const group = new THREE.Group();
    group.position.set(r.x0, 0, r.z0);
    group.add(ground);
    let tris = r.positions.length / 9;
    for (const [matrices, geometry] of [
      [r.pines, this.trees.pine],
      [r.broadleaves, this.trees.broadleaf],
    ] as const) {
      const count = matrices.length / 16;
      if (!count) continue;
      const im = new THREE.InstancedMesh(geometry, this.treeMaterial, count);
      im.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16);
      im.computeBoundingSphere();
      im.castShadow = im.receiveShadow = true;
      group.add(im);
      tris += (count * geometry.attributes.position!.count) / 3;
    }
    group.userData.tris = tris;
    group.visible = false;
    n.object = group;
    this.group.add(group);
    // Re-run selection so the new node shows up (or replaces a coarser one) right away.
    this.lastX = Infinity;
  }

  private evict(show: Set<Node>) {
    const built = [...this.nodes.values()].filter((n) => n.object);
    if (built.length <= this.opts.cache) {
      this.dropEmpty();
      return;
    }
    const wanted = new Set(this.desired);
    built
      .filter((n) => !show.has(n) && !wanted.has(n))
      .sort((a, b) => a.used - b.used)
      .slice(0, built.length - this.opts.cache)
      .forEach((n) => this.dispose(n));
    this.dropEmpty();
  }

  private dropEmpty() {
    const wanted = new Set(this.desired);
    for (const n of this.nodes.values()) if (!n.object && !n.pending && !wanted.has(n)) this.nodes.delete(n.key);
  }

  private dispose(n: Node) {
    if (n.object) {
      this.group.remove(n.object);
      (n.object.children[0] as THREE.Mesh).geometry.dispose();
      for (const c of n.object.children) if (c instanceof THREE.InstancedMesh) c.dispose();
    }
    this.nodes.delete(n.key);
  }
}
