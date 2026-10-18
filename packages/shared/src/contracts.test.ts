import { describe, expect, it } from "vitest";
import manifestJson from "../../../assets/build/manifest.json";
import { type Manifest, palette, scale, skeleton, slots, validateManifest } from "./contracts";

describe("skeleton contract", () => {
  const names = skeleton.bones.map((b) => b.name);

  it("has unique bone names without dots", () => {
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).not.toMatch(/[.:/[\]]/);
  });

  it("lists parents before children, with one root", () => {
    expect(skeleton.bones.filter((b) => b.parent === null)).toHaveLength(1);
    skeleton.bones.forEach((b, i) => {
      if (b.parent) expect(names.slice(0, i)).toContain(b.parent);
    });
  });

  it("stays in the ~20-25 deform bone range", () => {
    const deform = skeleton.bones.filter((b) => b.deform).length;
    expect(deform).toBeGreaterThanOrEqual(20);
    expect(deform).toBeLessThanOrEqual(25);
  });

  it("is mirrored left/right", () => {
    for (const b of skeleton.bones.filter((x) => x.name.endsWith("_L"))) {
      const r = skeleton.bones.find((x) => x.name === b.name.replace(/_L$/, "_R"));
      expect(r, b.name).toBeDefined();
      expect(r!.head).toEqual([-b.head[0], b.head[1], b.head[2]]);
      expect(r!.tail).toEqual([-b.tail[0], b.tail[1], b.tail[2]]);
    }
  });

  it("matches human height", () => {
    expect(skeleton.height).toBe(scale.humanHeight);
  });
});

describe("palette contract", () => {
  it("uses unique cells inside the grid", () => {
    const cells = Object.values(palette.swatches).map((s) => s.cell.join(","));
    expect(new Set(cells).size).toBe(cells.length);
    for (const s of Object.values(palette.swatches)) {
      expect(s.cell[0]).toBeLessThan(palette.columns);
      expect(s.cell[1]).toBeLessThan(palette.rows);
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("slots contract", () => {
  it("has the nine DESIGN.md slots", () => {
    expect(slots.map((s) => s.id)).toEqual(["body", "head", "hair", "top", "bottom", "shoes", "hat", "back", "face"]);
  });
});

describe("built manifest", () => {
  it("passes validation", () => {
    expect(validateManifest(manifestJson as Manifest)).toEqual([]);
  });
});
