// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Drawing IR geometry in Babylon, for every entity that gives it (a modifier, Geometry Nodes): a mesh as draw buffers,
// one vertex per face corner in Babylon's axes, on the node's mesh; instances as thin instances of their references'
// meshes; points as a point cloud. Where no kernel draws a mesh, each face is a fan of triangles with its flat normal.
import { Matrix, Mesh } from '@babylonjs/core';

/** @typedef {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array, uvs?: Float32Array }} DrawBuffers */
/**
 * How geometry is drawn: a mesh's draw buffers (a kernel's, else `triangulate`), and the Babylon node an ID draws as.
 * @typedef {{ meshBuffers?(mesh: import('./ir.js').Mesh): DrawBuffers | Promise<DrawBuffers>, nodeOf?(id: string): string | undefined }} Drawing
 */

/**
 * An IR mesh's draw buffers: Blender's (x, y, z) is Babylon's (x, z, y).
 * @param {import('./ir.js').Mesh} mesh
 * @returns {DrawBuffers}
 */
export function triangulate({ vert_positions: p, face_offsets, corner_verts, uvs }) {
  const corners = corner_verts.length, positions = new Float32Array(corners * 3), normals = new Float32Array(corners * 3), indices = [];
  for (let f = 0; f + 1 < face_offsets.length; f++) {
    const start = face_offsets[f], end = face_offsets[f + 1], normal = [0, 0, 0];
    for (let c = start; c < end; c++) {
      const v = corner_verts[c] * 3, w = corner_verts[c + 1 < end ? c + 1 : start] * 3;
      // Newell's normal, in Babylon's axes.
      normal[0] += (p[v + 1] - p[w + 1]) * (p[v + 2] + p[w + 2]);
      normal[2] += (p[v + 2] - p[w + 2]) * (p[v] + p[w]);
      normal[1] += (p[v] - p[w]) * (p[v + 1] + p[w + 1]);
      positions.set([p[v], p[v + 2], p[v + 1]], c * 3);
      if (c > start + 1) indices.push(start, c - 1, c);
    }
    const length = Math.hypot(...normal) || 1;
    for (let c = start; c < end; c++) normals.set(normal.map((n) => n / length), c * 3);
  }
  return { positions, normals, indices: Uint32Array.from(indices), ...(uvs && { uvs }) };
}

/**
 * Puts draw buffers on a mesh.
 * @param {Mesh} mesh
 * @param {DrawBuffers} buffers
 */
function setBuffers(mesh, { positions, normals, indices, uvs }) {
  mesh.makeGeometryUnique();
  mesh.setVerticesData('position', positions, false);
  mesh.setVerticesData('normal', normals, false);
  if (uvs) mesh.setVerticesData('uv', uvs, false);
  mesh.setIndices(indices);
  mesh.refreshBoundingInfo();
}

/**
 * A mesh made under `parent` for what it draws besides its own geometry, made again each time.
 * @param {Mesh} parent
 * @param {string} name
 */
function part(parent, name) {
  const id = `${parent.id}/${name}`;
  parent.getScene().getMeshById(id)?.dispose();
  const mesh = new Mesh(id, parent.getScene(), parent);
  mesh.id = id;
  mesh.material = parent.material;
  return mesh;
}

// Blender's axes to Babylon's: swaps Y and Z.
const SWAP = Matrix.FromArray([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);

/**
 * Draws a value an entity gives on the node's mesh: draw buffers, an IR mesh, or geometry.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} node
 * @param {any} value
 * @param {Drawing} [drawing]
 */
export async function drawGeometry(scene, node, value, { meshBuffers = triangulate, nodeOf = () => undefined } = {}) {
  const target = /** @type {Mesh | null} */ (scene.getMeshById(node));
  if (!target || target.isDisposed()) return;
  if (value.positions) return setBuffers(target, value);
  if (value.vert_positions) return setBuffers(target, await meshBuffers(value));
  const { mesh, points, instances } = value;
  setBuffers(target, mesh ? await meshBuffers(mesh) : { positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array() });
  if (points) {
    const cloud = part(target, 'points'), p = points.positions;
    cloud.setVerticesData('position', Float32Array.from(p, (_, i) => p[i - (i % 3) + [0, 2, 1][i % 3]]), false);
    if (cloud.material) cloud.material = Object.assign(cloud.material.clone(`${cloud.id}/material`) ?? cloud.material, { pointsCloud: true });
  }
  for (const [r, reference] of (instances?.references ?? []).entries()) {
    const source = 'id' in reference ? /** @type {Mesh | null} */ (scene.getMeshById(nodeOf(reference.id) ?? '')) : null;
    const instanced = part(target, `instances/${r}`);
    if (source?.geometry) {
      source.geometry.applyToMesh(instanced);
      instanced.material = source.material;
    } else if (reference.geometry?.mesh) setBuffers(instanced, await meshBuffers(reference.geometry.mesh));
    const matrices = [];
    for (let i = 0; i < instances.reference_indices.length; i++) {
      if (instances.reference_indices[i] === r) matrices.push(...SWAP.multiply(Matrix.FromArray(instances.transforms, i * 16)).multiply(SWAP).asArray());
    }
    instanced.thinInstanceSetBuffer('matrix', Float32Array.from(matrices), 16, true);
  }
}
