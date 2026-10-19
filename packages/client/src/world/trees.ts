// Low-poly tree models, built in code from palette colours: one draw call per kind per node.
import { palette } from "@zombros/shared";
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function part(geo: THREE.BufferGeometry, swatch: string, y: number, sy = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.scale(1, sy, 1);
  g.translate(0, y, 0);
  g.deleteAttribute("uv");
  const c = new THREE.Color(palette.swatches[swatch]!.color);
  const n = g.attributes.position!.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export function treeGeometries() {
  const pine = mergeGeometries([
    part(new THREE.CylinderGeometry(0.14, 0.2, 1.4, 5, 1, true), "bark", 0.7),
    part(new THREE.ConeGeometry(1.35, 2.6, 6, 1, true), "foliage_pine", 2.2),
    part(new THREE.ConeGeometry(1.0, 2.1, 6, 1, true), "foliage_pine", 3.5),
    part(new THREE.ConeGeometry(0.6, 1.5, 6, 1, true), "foliage_pine", 4.6),
  ])!;
  const broadleaf = mergeGeometries([
    part(new THREE.CylinderGeometry(0.16, 0.24, 2.4, 5, 1, true), "bark", 1.2),
    part(new THREE.IcosahedronGeometry(1.8, 0), "foliage_leaf", 3.6, 0.85),
  ])!;
  return { pine, broadleaf };
}
