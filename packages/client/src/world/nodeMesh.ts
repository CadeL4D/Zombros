// Builds one terrain quadtree node: flat-shaded triangles (one colour per face, from the palette)
// plus skirts that hide cracks between neighbours of different detail, and tree instance matrices.
// Pure data in, typed arrays out, so it runs in a Web Worker.
import { type Surface, type World, palette, TREE_PINE, treesInArea } from "@zombros/shared";

export interface NodeRequest {
  id: number;
  level: number;
  ix: number;
  iz: number;
  trees: boolean;
  /** Faces per side; leaves always use world.config.terrain.segments (World.groundHeight matches them). */
  segments: number;
}

export interface NodeResult {
  id: number;
  /** World-space origin of the node; positions are relative to it. */
  x0: number;
  z0: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Column-major 4x4 instance matrices (relative to the origin), per tree kind. */
  pines: Float32Array;
  broadleaves: Float32Array;
}

/** sRGB hex -> linear RGB, which is what vertex colours are in. */
export function linearRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [f(n >> 16), f((n >> 8) & 255), f(n & 255)];
}

const surfaceColor = new Map<Surface, [number, number, number]>();
function colorOf(s: Surface) {
  let c = surfaceColor.get(s);
  if (!c) surfaceColor.set(s, (c = linearRGB(palette.swatches[s]!.color)));
  return c;
}

export function nodeSize(world: World, level: number) {
  return world.config.size / 2 ** level;
}

export function buildNode(world: World, req: NodeRequest): NodeResult {
  const S = req.segments;
  const size = nodeSize(world, req.level);
  const half = world.config.size / 2;
  const x0 = -half + req.ix * size;
  const z0 = -half + req.iz * size;
  const step = size / S;

  const N = S + 1;
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = world.heightAt(x0 + i * step, z0 + j * step);

  const faces = S * S * 2 + 4 * S * 2;
  const positions = new Float32Array(faces * 9);
  const normals = new Float32Array(faces * 9);
  const colors = new Float32Array(faces * 9);
  let f = 0;

  const put = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, col: [number, number, number], shade: number) => {
    const o = f * 9;
    positions.set([ax, ay, az, bx, by, bz, cx, cy, cz], o);
    for (let k = 0; k < 3; k++) {
      normals[o + k * 3] = nx;
      normals[o + k * 3 + 1] = ny;
      normals[o + k * 3 + 2] = nz;
      colors[o + k * 3] = col[0] * shade;
      colors[o + k * 3 + 1] = col[1] * shade;
      colors[o + k * 3 + 2] = col[2] * shade;
    }
    f++;
  };

  // Faces: diagonal a-d, matching World.groundHeight.
  const tri = (ai: number, aj: number, bi: number, bj: number, ci: number, cj: number) => {
    const ax = ai * step, az = aj * step, ay = h[aj * N + ai]!;
    const bx = bi * step, bz = bj * step, by = h[bj * N + bi]!;
    const cx = ci * step, cz = cj * step, cy = h[cj * N + ci]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const mx = x0 + (ax + bx + cx) / 3;
    const mz = z0 + (az + bz + cz) / 3;
    const surface = world.surfaceAt(mx, mz, (ay + by + cy) / 3, ny);
    // Small per-face brightness jitter: the faceted low-poly look.
    const shade = 0.94 + 0.12 * (((Math.imul(Math.floor(mx * 7.13), 73856093) ^ Math.imul(Math.floor(mz * 5.77), 19349663)) >>> 0) / 4294967296);
    put(ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, colorOf(surface), shade);
  };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      tri(i, j, i, j + 1, i + 1, j + 1);
      tri(i, j, i + 1, j + 1, i + 1, j);
    }
  }

  // Skirts: a curtain hanging under each edge.
  const drop = step * 1.5 + 4;
  const skirt = (ai: number, aj: number, bi: number, bj: number) => {
    const ax = ai * step, az = aj * step, ay = h[aj * N + ai]!;
    const bx = bi * step, bz = bj * step, by = h[bj * N + bi]!;
    const c = colorOf(world.surfaceAt(x0 + (ax + bx) / 2, z0 + (az + bz) / 2, (ay + by) / 2, 0.9));
    put(ax, ay, az, bx, by, bz, ax, ay - drop, az, 0, 1, 0, c, 0.9);
    put(bx, by, bz, bx, by - drop, bz, ax, ay - drop, az, 0, 1, 0, c, 0.9);
  };
  for (let k = 0; k < S; k++) {
    skirt(k, 0, k + 1, 0); // north edge (z0), facing -z
    skirt(k + 1, S, k, S); // south edge, facing +z
    skirt(0, k + 1, 0, k); // west edge, facing -x
    skirt(S, k, S, k + 1); // east edge, facing +x
  }

  let pines = new Float32Array(0);
  let broadleaves = new Float32Array(0);
  if (req.trees) {
    const trees = treesInArea(world, x0, z0, size);
    const np = trees.filter((t) => t.kind === TREE_PINE).length;
    pines = new Float32Array(np * 16);
    broadleaves = new Float32Array((trees.length - np) * 16);
    let p = 0;
    let b = 0;
    for (const t of trees) {
      const c = Math.cos(t.rot) * t.scale;
      const s = Math.sin(t.rot) * t.scale;
      const m = [c, 0, -s, 0, 0, t.scale, 0, 0, s, 0, c, 0, t.x - x0, t.y - 0.2, t.z - z0, 1];
      if (t.kind === TREE_PINE) pines.set(m, 16 * p++);
      else broadleaves.set(m, 16 * b++);
    }
  }

  return { id: req.id, x0, z0, positions, normals, colors, pines, broadleaves };
}
