// Typed views of the modular contracts in content/contracts (DESIGN.md §3, §3a).
// The JSON files are the source of truth; Blender (assets/pipeline) reads the same files.
import paletteJson from "../../../content/contracts/palette.json";
import scaleJson from "../../../content/contracts/scale.json";
import skeletonJson from "../../../content/contracts/skeleton.json";
import slotsJson from "../../../content/contracts/slots.json";

export type Vec3 = [number, number, number];

export interface Bone {
  name: string;
  parent: string | null;
  head: Vec3;
  tail: Vec3;
  deform: boolean;
}

export interface Skeleton {
  version: number;
  restPose: string;
  height: number;
  bones: Bone[];
}

export type SlotId = "body" | "head" | "hair" | "top" | "bottom" | "shoes" | "hat" | "back" | "face";

export interface Slot {
  id: SlotId;
  required: boolean;
  maxTris: number;
  hides: SlotId[];
  desc: string;
}

export interface Swatch {
  cell: [number, number];
  color: string;
  emissive?: boolean;
}

export interface Palette {
  version: number;
  image: string;
  cellSize: number;
  columns: number;
  rows: number;
  swatches: Record<string, Swatch>;
}

export type Scale = typeof scaleJson;

export interface ManifestEntry {
  id: string;
  kind: "character" | "clothing" | "prop" | "building" | "vehicle" | "weapon";
  file: string;
  slots?: Partial<Record<SlotId, string>>;
  tris: Record<string, number>;
  skeleton?: number;
  morphs?: string[];
  tags: string[];
}

export interface Manifest {
  version: number;
  assets: ManifestEntry[];
}

export const skeleton = skeletonJson as unknown as Skeleton;
export const slots = slotsJson.slots as Slot[];
export const palette = paletteJson as unknown as Palette;
export const scale: Scale = scaleJson;

/** UV of a swatch centre, glTF convention (origin top-left). */
export function swatchUV(name: string, pal: Palette = palette): [number, number] {
  const sw = pal.swatches[name];
  if (!sw) throw new Error(`unknown swatch ${name}`);
  const [col, row] = sw.cell;
  return [(col + 0.5) / pal.columns, (row + 0.5) / pal.rows];
}

/** Returns a list of contract violations in a manifest (empty = valid). */
export function validateManifest(m: Manifest): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const slotIds = new Set(slots.map((s) => s.id));
  for (const a of m.assets) {
    if (ids.has(a.id)) errors.push(`duplicate id ${a.id}`);
    ids.add(a.id);
    if (!a.file.endsWith(".glb")) errors.push(`${a.id}: file must be .glb`);
    for (const slot of Object.keys(a.slots ?? {})) {
      if (!slotIds.has(slot as SlotId)) errors.push(`${a.id}: unknown slot ${slot}`);
    }
    if (a.kind === "character" && a.skeleton !== skeleton.version) {
      errors.push(`${a.id}: skeleton v${a.skeleton} != contract v${skeleton.version}`);
    }
    for (const [mesh, tris] of Object.entries(a.tris)) {
      const slot = slots.find((s) => s.id === mesh);
      if (slot && tris > slot.maxTris) errors.push(`${a.id}/${mesh}: ${tris} tris > ${slot.maxTris}`);
    }
  }
  return errors;
}
