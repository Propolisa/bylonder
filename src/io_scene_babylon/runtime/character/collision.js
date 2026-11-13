// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// What characters collide with, without a physics engine: the world triangles of a scene's meshes in 1 m cells over the
// ground plane, made once per scene and shared. A mesh that moves is put in its new cells when a character next asks
// about it, so meshes that move every frame but no one collides with (a character's own body) cost nothing. The
// ground is a ray down through a cell's
// triangles; walls push spheres up a capsule out of the triangles near them. Nothing allocates per query, and nothing
// needs Babylon's collision or picking modules.

import { Vector3 } from '@babylonjs/core';

const CELL = 1;
/** @type {WeakMap<import('@babylonjs/core').Scene, ReturnType<typeof createWorld>>} */
const worlds = new WeakMap();

/**
 * A mesh that can hold a character up or stop it: geometry of its own, pickable (not a sky), not deformed by a skeleton.
 * Instanced scatter (thin instances, and instances lower than `step`) is grass: walked through, never stood on. Whether
 * it is shown is asked each frame (`shown`).
 * @param {import('@babylonjs/core').AbstractMesh} mesh @param {number} step
 */
function solid(mesh, step) {
  if (!mesh.isPickable || mesh.infiniteDistance || mesh.skeleton || mesh.getTotalVertices() === 0) return false;
  if (/** @type {any} */ (mesh).thinInstanceCount > 0) return false;
  if (mesh.getClassName() !== 'InstancedMesh') return true;
  const { minimumWorld: min, maximumWorld: max } = mesh.getBoundingInfo().boundingBox;
  return max.y - min.y >= step;
}

/** Whether a mesh is in the scene now: enabled and seen. A hidden mesh never holds up or stops a character. */
export const shown = (/** @type {import('@babylonjs/core').AbstractMesh} */ mesh) => mesh.isEnabled() && mesh.isVisible && mesh.visibility > 0;

/** The scene's collision world, made the first time a character asks. @param {import('@babylonjs/core').Scene} scene @param {number} step */
export function collisionWorld(scene, step) {
  let world = worlds.get(scene);
  if (!world) worlds.set(scene, (world = createWorld(scene, step)));
  return world;
}

/** @param {import('@babylonjs/core').Scene} scene @param {number} step */
function createWorld(scene, step) {
  /** @type {{ mesh: import('@babylonjs/core').AbstractMesh, tris: Float32Array, stamps: Uint32Array, keys: number[], placed: Float32Array, moved: boolean }[]} */
  const meshes = [];
  /** Meshes moved since they were last put in their cells. @type {number[]} */
  const moved = [];
  /** Per cell, pairs of (mesh, triangle) indices. @type {Map<number, number[]>} */
  const cells = new Map();
  const key = (/** @type {number} */ cx, /** @type {number} */ cz) => (cx + 2 ** 20) * 2 ** 21 + (cz + 2 ** 20);
  const unlink = (/** @type {number} */ m) => {
    for (const k of meshes[m].keys) {
      const list = /** @type {number[]} */ (cells.get(k));
      let w = 0;
      for (let r = 0; r < list.length; r += 2) if (list[r] !== m) { list[w++] = list[r]; list[w++] = list[r + 1]; }
      list.length = w;
    }
    meshes[m].keys.length = 0;
  };
  /** Puts a mesh's triangles, in the world as it is now, in their cells. @param {number} m */
  const link = (m) => {
    const entry = meshes[m], { mesh } = entry, source = /** @type {any} */ (mesh).sourceMesh ?? mesh;
    const positions = source.getVerticesData('position'), indices = source.getIndices();
    if (!positions) return;
    const count = indices ? indices.length / 3 : positions.length / 9, matrix = mesh.getWorldMatrix().m;
    entry.placed.set(matrix);
    if (entry.tris.length !== count * 9) { entry.tris = new Float32Array(count * 9); entry.stamps = new Uint32Array(count); }
    const tris = entry.tris, seen = new Set();
    for (let t = 0; t < count; t++) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = (indices ? indices[t * 3 + k] : t * 3 + k) * 3, x = positions[i], y = positions[i + 1], z = positions[i + 2], o = t * 9 + k * 3;
        tris[o] = x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12];
        tris[o + 1] = x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13];
        tris[o + 2] = x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14];
        x0 = Math.min(x0, tris[o]); x1 = Math.max(x1, tris[o]); z0 = Math.min(z0, tris[o + 2]); z1 = Math.max(z1, tris[o + 2]);
      }
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = key(cx, cz);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(m, t);
        seen.add(k);
      }
    }
    for (const k of seen) entry.keys.push(k);
  };
  const add = (/** @type {import('@babylonjs/core').AbstractMesh} */ mesh) => {
    if (!solid(mesh, step) || meshes.some((e) => e.mesh === mesh)) return;
    const m = meshes.push({ mesh, tris: new Float32Array(0), stamps: new Uint32Array(0), keys: [], placed: new Float32Array(16), moved: false }) - 1;
    mesh.computeWorldMatrix(true);
    link(m);
    // A mesh that moves (a lift, a door) is noted, and put in its new cells when it is next asked about.
    mesh.onAfterWorldMatrixUpdateObservable.add(() => {
      const entry = meshes[m], now = mesh.getWorldMatrix().m;
      if (entry.moved) return;
      for (let i = 0; i < 16; i++) if (now[i] !== entry.placed[i]) { entry.moved = true; moved.push(m); return; }
    });
  };
  /** Puts the moved meshes that `allowed` lets in in their new cells. @param {Uint8Array} allowed */
  const settle = (allowed) => {
    for (let i = moved.length - 1; i >= 0; i--) {
      const m = moved[i];
      if (!allowed[m]) continue;
      unlink(m);
      link(m);
      meshes[m].moved = false;
      moved[i] = moved[moved.length - 1];
      moved.pop();
    }
  };
  scene.meshes.forEach(add);
  // A new mesh joins once it has geometry: Babylon tells of it a tick after it is made, when a static one may never
  // update its world matrix again.
  scene.onNewMeshAddedObservable.add((mesh) => {
    if (mesh.getTotalVertices() > 0) return add(mesh);
    const placed = mesh.onAfterWorldMatrixUpdateObservable.add(() => {
      if (mesh.getTotalVertices() === 0) return;
      mesh.onAfterWorldMatrixUpdateObservable.remove(placed);
      add(mesh);
    });
  });
  let stamp = 0;
  const hit = { height: 0, normal: new Vector3(0, 1, 0) };
  const closest = [0, 0, 0];

  return {
    meshes,
    /**
     * The highest ground under (x, z) from `top` down `length`, among the meshes `allowed` lets in, or null. The hit
     * is reused by the next call.
     * @param {number} x @param {number} z @param {number} top @param {number} length @param {Uint8Array} allowed
     */
    ground(x, z, top, length, allowed) {
      settle(allowed);
      const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!list) return null;
      let best = -Infinity;
      for (let r = 0; r < list.length; r += 2) {
        const m = list[r];
        if (!allowed[m]) continue;
        const t = meshes[m].tris, o = list[r + 1] * 9;
        const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
        // Barycentric coordinates of (x, z) over the triangle seen from above.
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-12) continue;
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, w = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
        const y = u * ay + v * by + w * cy;
        if (y > top || y < top - length || y <= best) continue;
        best = y;
        let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) * (ny < 0 ? -1 : 1);
        hit.normal.set(nx / l, ny / l, nz / l);
      }
      if (best === -Infinity) return null;
      hit.height = best;
      return hit;
    },
    /**
     * Pushes a sphere at (x, y, z) of `radius` out of the triangles of the meshes `allowed` lets in, sideways only;
     * gives the push in `out` (x, z).
     * @param {number} x @param {number} y @param {number} z @param {number} radius @param {Uint8Array} allowed @param {number[]} out
     */
    push(x, y, z, radius, allowed, out) {
      settle(allowed);
      out[0] = 0; out[1] = 0;
      stamp++;
      for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) for (let cz = Math.floor((z - radius) / CELL); cz <= Math.floor((z + radius) / CELL); cz++) {
        const list = cells.get(key(cx, cz));
        if (!list) continue;
        for (let r = 0; r < list.length; r += 2) {
          const m = list[r], entry = meshes[m], t = list[r + 1];
          if (!allowed[m] || entry.stamps[t] === stamp) continue;
          entry.stamps[t] = stamp;
          closestOnTriangle(entry.tris, t * 9, x + out[0], y, z + out[1], closest);
          const dx = x + out[0] - closest[0], dz = z + out[1] - closest[2], dy = y - closest[1];
          const d2 = dx * dx + dy * dy + dz * dz, side = Math.sqrt(dx * dx + dz * dz);
          if (d2 >= radius * radius || side < 1e-6) continue;
          // Out along the ground plane, by what the sphere overlaps there.
          const depth = Math.sqrt(radius * radius - dy * dy) - side;
          out[0] += (dx / side) * depth;
          out[1] += (dz / side) * depth;
        }
      }
      return out;
    },
  };
}

/** The point of triangle `t` at `o` nearest (px, py, pz), into `out` (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(/** @type {Float32Array} */ t, /** @type {number} */ o, /** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ pz, /** @type {number[]} */ out) {
  const ax = t[o], ay = t[o + 1], az = t[o + 2];
  const abx = t[o + 3] - ax, aby = t[o + 4] - ay, abz = t[o + 5] - az, acx = t[o + 6] - ax, acy = t[o + 7] - ay, acz = t[o + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az, bpx = px - t[o + 3], bpy = py - t[o + 4], bpz = pz - t[o + 5];
  const cpx = px - t[o + 6], cpy = py - t[o + 7], cpz = pz - t[o + 8];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  const va = d3 * d6 - d5 * d4, vb = d5 * d2 - d1 * d6, vc = d1 * d4 - d3 * d2;
  // The triangle's region the point is over, as weights of AB and AC.
  let v, w;
  if (d1 <= 0 && d2 <= 0) { v = 0; w = 0; }
  else if (d3 >= 0 && d4 <= d3) { v = 1; w = 0; }
  else if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); w = 0; }
  else if (d6 >= 0 && d5 <= d6) { v = 0; w = 1; }
  else if (vb <= 0 && d2 >= 0 && d6 <= 0) { v = 0; w = d2 / (d2 - d6); }
  else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / (d4 - d3 + (d5 - d6)); v = 1 - w; }
  else { const denom = 1 / (va + vb + vc); v = vb * denom; w = vc * denom; }
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}
