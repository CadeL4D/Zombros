import { describe, expect, it } from "vitest";
import { palette } from "./contracts";
import { hash3, simplex2 } from "./noise";
import { SURFACES, createWorld, treesInArea } from "./world";

describe("noise", () => {
  it("is deterministic per seed", () => {
    const a = simplex2(7);
    const b = simplex2(7);
    const c = simplex2(8);
    for (let i = 0; i < 50; i++) {
      const x = i * 1.37 - 20;
      const y = i * -0.91 + 5;
      expect(a(x, y)).toBe(b(x, y));
      expect(Math.abs(a(x, y))).toBeLessThanOrEqual(1);
    }
    expect([0, 1, 2, 3].map((i) => a(i + 0.5, 0.25))).not.toEqual([0, 1, 2, 3].map((i) => c(i + 0.5, 0.25)));
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
  });
});

describe("world", () => {
  const world = createWorld(1337);
  const half = world.config.size / 2;
  const cell = world.config.terrain.leafSize / world.config.terrain.segments;

  it("is the same from the same seed", () => {
    const other = createWorld(1337);
    for (const [x, z] of [[0, 0], [1234.5, -987.25], [-6000, 7000]] as const) {
      expect(other.heightAt(x, z)).toBe(world.heightAt(x, z));
    }
  });

  it("is ocean at the map edge and land at spawn", () => {
    expect(world.heightAt(half - 10, 0)).toBeLessThan(world.config.seaLevel);
    expect(world.heightAt(0, -(half - 10))).toBeLessThan(world.config.seaLevel);
    const s = world.findSpawn();
    expect(world.heightAt(s.x, s.z)).toBeGreaterThan(world.config.seaLevel + 2);
    expect(Math.hypot(s.x, s.z)).toBeLessThan(1500);
  });

  it("ground height matches grid samples and is continuous", () => {
    const x0 = 10 * cell - half;
    const z0 = 20 * cell - half;
    expect(world.groundHeight(x0, z0)).toBeCloseTo(world.heightAt(x0, z0), 6);
    expect(world.groundHeight(x0 + cell, z0 + cell)).toBeCloseTo(world.heightAt(x0 + cell, z0 + cell), 6);
    // Crossing the diagonal and cell edges should not jump.
    for (let k = 0; k < 200; k++) {
      const x = 300 + k * 0.173;
      const z = -150 + k * 0.117;
      expect(Math.abs(world.groundHeight(x + 0.001, z) - world.groundHeight(x, z))).toBeLessThan(0.05);
    }
  });

  it("maps every surface to a palette swatch", () => {
    for (const s of SURFACES) expect(palette.swatches[s], s).toBeDefined();
  });

  it("places trees deterministically on land", () => {
    const a = treesInArea(world, -512, -512, 1024);
    const b = treesInArea(createWorld(1337), -512, -512, 1024);
    expect(a.length).toBeGreaterThan(50);
    expect(a).toEqual(b);
    for (const t of a) expect(t.y).toBeGreaterThan(world.config.seaLevel);
  });
});
