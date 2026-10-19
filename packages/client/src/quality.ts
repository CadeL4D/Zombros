// Quality tiers (DESIGN.md §3a frame budgets). Phones get "low" automatically; override with ?quality=low|high.
export interface Quality {
  name: "low" | "high";
  pixelRatio: number;
  antialias: boolean;
  shadowMap: number;
  /** Half-size of the shadowed area around the player, metres. */
  shadowExtent: number;
  viewDistance: number;
  lodFactor: number;
  treeNodeMax: number;
  coarseSegments: number;
  workers: number;
}

export function pickQuality(): Quality {
  const param = new URLSearchParams(location.search).get("quality");
  const phone = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 900;
  const cores = navigator.hardwareConcurrency || 4;
  const workers = Math.max(1, Math.min(3, cores - 1));
  if (param === "low" || (param !== "high" && phone)) {
    return { name: "low", pixelRatio: Math.min(devicePixelRatio, 1.5), antialias: false, shadowMap: 1024, shadowExtent: 28, viewDistance: 1400, lodFactor: 1.5, treeNodeMax: 128, coarseSegments: 16, workers };
  }
  return { name: "high", pixelRatio: Math.min(devicePixelRatio, 2), antialias: true, shadowMap: 2048, shadowExtent: 48, viewDistance: 3200, lodFactor: 2.2, treeNodeMax: 256, coarseSegments: 32, workers };
}
