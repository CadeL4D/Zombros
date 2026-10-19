// Deterministic world generation, macro layer (DESIGN.md §4): one seed -> terrain heights,
// surface types and tree placement. Clients mesh from this; the host will use it for physics.
// Regions (§5), rivers and settlements come later and plug in here.
import worldJson from "../../../content/world/default.json";
import { fbm, hash01, ridged, simplex2 } from "./noise";

export type WorldConfig = typeof worldJson;
export const worldConfig: WorldConfig = worldJson;

/** Ground surface types; each maps to a palette swatch. */
export const SURFACES = ["terrain_grass", "terrain_grass_dark", "terrain_dirt", "terrain_sand", "terrain_rock", "terrain_snow"] as const;
export type Surface = (typeof SURFACES)[number];

export const TREE_PINE = 0;
export const TREE_BROADLEAF = 1;

export interface Tree {
  x: number;
  y: number;
  z: number;
  kind: typeof TREE_PINE | typeof TREE_BROADLEAF;
  scale: number;
  rot: number;
}

export interface World {
  seed: number;
  config: WorldConfig;
  /** Exact terrain height at a point (metres; sea level = config.seaLevel). */
  heightAt(x: number, z: number): number;
  /**
   * Height of the finest terrain mesh at a point: the same grid samples and triangle split the
   * renderer uses, so feet sit exactly on the visible ground.
   */
  groundHeight(x: number, z: number): number;
  /** Upward component of the surface normal at a point (1 = flat). */
  flatness(x: number, z: number): number;
  surfaceAt(x: number, z: number, h: number, ny: number): Surface;
  /** The tree growing in tree-grid cell (ci, cj), if any. */
  treeInCell(ci: number, cj: number): Tree | null;
  /** A dry, gentle spot near the map centre to start on. */
  findSpawn(): { x: number; z: number };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createWorld(seed: number = worldConfig.seed, config: WorldConfig = worldConfig): World {
  const nContinent = simplex2(seed);
  const nHills = simplex2(seed + 1);
  const nDetail = simplex2(seed + 2);
  const nMountMask = simplex2(seed + 3);
  const nRidge = simplex2(seed + 4);
  const nForest = simplex2(seed + 5);
  const nSurface = simplex2(seed + 6);

  const half = config.size / 2;
  const cell = config.terrain.leafSize / config.terrain.segments;
  const sea = config.seaLevel;

  /** > 0 on land, < 0 at sea. Map edges are always ocean; the start area is always land. */
  function continent(x: number, z: number) {
    let c = fbm(nContinent, x / 3500, z / 3500, 4) + 0.3;
    const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
    c -= smoothstep(0.75, 0.97, edge) * 1.8;
    c += 0.6 * Math.max(0, 1 - Math.hypot(x, z) / 1500);
    return c;
  }

  function heightAt(x: number, z: number): number {
    const c = continent(x, z);
    // The start area (Suburbs) stays gentle; danger and relief grow with distance.
    const calm = smoothstep(2500, 700, Math.hypot(x, z));
    const hills = fbm(nHills, x / 700, z / 700, 5) * 24 * (1 - 0.6 * calm);
    const detail = fbm(nDetail, x / 110, z / 110, 3) * 2.5;
    const mask = smoothstep(0.05, 0.5, fbm(nMountMask, x / 5000, z / 5000, 3)) * (1 - calm);
    const r = ridged(nRidge, x / 1800, z / 1800, 5);
    const mountains = Math.pow(r, 1.8) * config.terrain.maxHeight * mask;
    const land = 3 + c * 18 + hills + detail + mountains * smoothstep(0.1, 0.5, c);
    const seabed = Math.max(-45, c * 70) + detail;
    return sea + lerp(seabed, land, smoothstep(-0.03, 0.2, c));
  }

  function groundHeight(x: number, z: number): number {
    const gx = (x + half) / cell;
    const gz = (z + half) / cell;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const x0 = i * cell - half;
    const z0 = j * cell - half;
    const ha = heightAt(x0, z0);
    const hd = heightAt(x0 + cell, z0 + cell);
    // Same diagonal (a-d) as the terrain mesh.
    if (fz > fx) {
      const hc = heightAt(x0, z0 + cell);
      return ha + (hd - hc) * fx + (hc - ha) * fz;
    }
    const hb = heightAt(x0 + cell, z0);
    return ha + (hb - ha) * fx + (hd - hb) * fz;
  }

  function flatness(x: number, z: number): number {
    const e = 1;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    return (2 * e) / Math.hypot(dx, 2 * e, dz);
  }

  function surfaceAt(x: number, z: number, h: number, ny: number): Surface {
    const v = nSurface(x / 40, z / 40);
    const above = h - sea;
    if (ny < 0.7) return "terrain_rock";
    if (above > 250 + v * 30) return ny > 0.8 ? "terrain_snow" : "terrain_rock";
    if (above < 1.6 + v * 0.8) return "terrain_sand";
    if (ny < 0.82 || above > 180 + v * 25) return v > 0.2 ? "terrain_rock" : "terrain_dirt";
    if (v > 0.62) return "terrain_dirt";
    return fbm(nForest, x / 900, z / 900, 3) > 0.12 ? "terrain_grass_dark" : "terrain_grass";
  }

  function treeInCell(ci: number, cj: number): Tree | null {
    const size = config.trees.cell;
    const x = (ci + 0.15 + 0.7 * hash01(ci, cj, seed)) * size;
    const z = (cj + 0.15 + 0.7 * hash01(ci, cj, seed + 1)) * size;
    if (Math.abs(x) > half || Math.abs(z) > half) return null;
    const forest = fbm(nForest, x / 900, z / 900, 3);
    const density = smoothstep(0.0, 0.45, forest) * 0.6 + 0.015;
    if (hash01(ci, cj, seed + 2) > density) return null;
    const h = heightAt(x, z);
    const ny = flatness(x, z);
    const s = surfaceAt(x, z, h, ny);
    if (s !== "terrain_grass" && s !== "terrain_grass_dark") return null;
    const pineChance = smoothstep(20, 120, h - sea) * 0.7 + 0.25;
    return {
      x,
      y: groundHeight(x, z),
      z,
      kind: hash01(ci, cj, seed + 3) < pineChance ? TREE_PINE : TREE_BROADLEAF,
      scale: 0.8 + 0.6 * hash01(ci, cj, seed + 4),
      rot: hash01(ci, cj, seed + 5) * Math.PI * 2,
    };
  }

  function findSpawn() {
    // Spiral out from the centre until we hit dry, gentle grass with no tree on it.
    for (let r = 0; r < 3000; r += 7) {
      const steps = Math.max(1, Math.floor(r / 5));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r);
        const z = Math.round(Math.sin(a) * r);
        const h = heightAt(x, z) - sea;
        if (h > 3 && h < 40 && flatness(x, z) > 0.97) return { x, z };
      }
    }
    return { x: 0, z: 0 };
  }

  return { seed, config, heightAt, groundHeight, flatness, surfaceAt, treeInCell, findSpawn };
}

/** Trees whose cells overlap the axis-aligned square [x0, x0+size] x [z0, z0+size]. */
export function treesInArea(world: World, x0: number, z0: number, size: number): Tree[] {
  const c = world.config.trees.cell;
  const out: Tree[] = [];
  const i0 = Math.floor(x0 / c);
  const j0 = Math.floor(z0 / c);
  const i1 = Math.ceil((x0 + size) / c);
  const j1 = Math.ceil((z0 + size) / c);
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const t = world.treeInCell(i, j);
      if (t && t.x >= x0 && t.x < x0 + size && t.z >= z0 && t.z < z0 + size) out.push(t);
    }
  }
  return out;
}
