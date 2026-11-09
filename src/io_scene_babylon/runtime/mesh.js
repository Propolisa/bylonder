// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Drawing IR geometry in Babylon, for every entity that gives it (a modifier, Geometry Nodes): a mesh as draw buffers,
// one vertex per face corner in Babylon's axes, on the node's mesh, a submesh per material; instances as thin instances
// of their references' meshes; points as a point cloud; a Grease Pencil layer's drawing under its object's node. Where no kernel draws a mesh, each face is a fan of triangles,
// a smooth face with its vertices' normals (its faces' normals weighted by their corner angles), a sharp one
// (`sharp_face`) with its own.
import { Matrix, Mesh, SubMesh } from '@babylonjs/core';

/**
 * Draw buffers; `groups` are the triangles of each material index as [index, first index, index count].
 * @typedef {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array, uvs?: Float32Array, groups?: [number, number, number][] }} DrawBuffers
 */
/**
 * How geometry is drawn: a mesh's draw buffers (a kernel's, else `triangulate`), and the Babylon node an ID draws as.
 * A Grease Pencil layer's drawing, under its object's node (grease-pencil.js draw).
 * @typedef {{ meshBuffers?(mesh: import('./ir.js').Mesh): DrawBuffers | Promise<DrawBuffers>, nodeOf?(id: string): string | undefined,
 *   greasePencil?(node: string, layer: any): Promise<void> }} Drawing
 */

/** @param {ArrayLike<number>} p @param {number} a @param {number} b */
const sub = (p, a, b) => [p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]];
/** @param {number[]} u @param {number[]} v */
const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) || 1))));

/**
 * An IR mesh's draw buffers: Blender's (x, y, z) is Babylon's (x, z, y).
 * @param {import('./ir.js').Mesh} mesh
 * @returns {DrawBuffers}
 */
export function triangulate({ vert_positions: p, face_offsets, corner_verts, uvs, attributes = {} }) {
  const faces = face_offsets.length - 1, corners = corner_verts.length, sharp = attributes.sharp_face?.data, material = attributes.material_index?.data;
  const uv = uvs ?? Object.values(attributes).find((a) => a.domain === 'CORNER' && a.type === 'FLOAT2')?.data;
  const faceNormals = new Float32Array(faces * 3), vertNormals = new Float32Array(p.length);
  for (let f = 0; f < faces; f++) {
    const start = face_offsets[f], end = face_offsets[f + 1], normal = [0, 0, 0];
    for (let c = start; c < end; c++) {
      const v = corner_verts[c] * 3, w = corner_verts[c + 1 < end ? c + 1 : start] * 3;
      // Newell's normal.
      normal[0] += (p[v + 1] - p[w + 1]) * (p[v + 2] + p[w + 2]);
      normal[1] += (p[v + 2] - p[w + 2]) * (p[v] + p[w]);
      normal[2] += (p[v] - p[w]) * (p[v + 1] + p[w + 1]);
    }
    const length = Math.hypot(...normal) || 1;
    faceNormals.set(normal.map((n) => n / length), f * 3);
    if (sharp?.[f]) continue;
    for (let c = start; c < end; c++) {
      const v = corner_verts[c] * 3;
      const weight = angle(sub(p, corner_verts[c > start ? c - 1 : end - 1] * 3, v), sub(p, corner_verts[c + 1 < end ? c + 1 : start] * 3, v));
      for (let k = 0; k < 3; k++) vertNormals[v + k] += faceNormals[f * 3 + k] * weight;
    }
  }
  const positions = new Float32Array(corners * 3), normals = new Float32Array(corners * 3);
  /** @type {Map<number, number[]>} */
  const byMaterial = new Map();
  for (let f = 0; f < faces; f++) {
    const start = face_offsets[f], end = face_offsets[f + 1], index = material?.[f] ?? 0;
    if (!byMaterial.has(index)) byMaterial.set(index, []);
    const triangles = /** @type {number[]} */ (byMaterial.get(index));
    for (let c = start; c < end; c++) {
      const v = corner_verts[c] * 3, n = sharp?.[f] ? faceNormals.subarray(f * 3, f * 3 + 3) : vertNormals.subarray(v, v + 3), length = Math.hypot(...n) || 1;
      positions.set([p[v], p[v + 2], p[v + 1]], c * 3);
      normals.set([n[0] / length, n[2] / length, n[1] / length], c * 3);
      if (c > start + 1) triangles.push(start, c - 1, c);
    }
  }
  const sorted = [...byMaterial].sort(([a], [b]) => a - b);
  /** @type {[number, number, number][]} */
  const groups = [];
  sorted.reduce((first, [index, triangles]) => (groups.push([index, first, triangles.length]), first + triangles.length), 0);
  return { positions, normals, indices: Uint32Array.from(sorted.flatMap(([, t]) => t)), ...(uv && { uvs: Float32Array.from(uv) }), ...(material && { groups }) };
}

/**
 * Puts draw buffers on a mesh, a submesh per material index, each on the material slot `slot` gives.
 * @param {Mesh} mesh
 * @param {DrawBuffers} buffers
 * @param {(index: number) => number} [slot]
 */
function setBuffers(mesh, { positions, normals, indices, uvs, groups }, slot = (index) => index) {
  mesh.makeGeometryUnique();
  mesh.setVerticesData('position', positions, false);
  mesh.setVerticesData('normal', normals, false);
  if (uvs) mesh.setVerticesData('uv', uvs, false);
  mesh.setIndices(indices);
  if (groups) {
    mesh.subMeshes = [];
    for (const [index, start, count] of groups) new SubMesh(slot(index), 0, positions.length / 3, start, count, mesh);
  }
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
export async function drawGeometry(scene, node, value, { meshBuffers = triangulate, nodeOf = () => undefined, greasePencil } = {}) {
  if (value.grease_pencil) return greasePencil?.(node, value.grease_pencil);
  const target = /** @type {Mesh | null} */ (scene.getMeshById(node));
  if (!target || target.isDisposed()) return;
  if (value.positions) return setBuffers(target, value);
  if (value.vert_positions) return setBuffers(target, await meshBuffers(value));
  const { mesh, points, instances } = value;
  // What the geometry draws besides its mesh is made again: the parts drawn before go, and the thin instances the export baked hide.
  for (const child of target.getChildMeshes(true)) {
    if (child.id.startsWith(`${target.id}/`)) child.dispose();
    else if (child.hasThinInstances) child.setEnabled(false);
  }
  setBuffers(target, mesh ? await meshBuffers(mesh) : { positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array() }, slotOf(target, mesh?.materials));
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
    } else if (reference.geometry?.mesh) setBuffers(instanced, await meshBuffers(reference.geometry.mesh), slotOf(instanced, reference.geometry.mesh.materials));
    const matrices = [];
    for (let i = 0; i < instances.reference_indices.length; i++) {
      if (instances.reference_indices[i] === r) matrices.push(...SWAP.multiply(Matrix.FromArray(instances.transforms, i * 16)).multiply(SWAP).asArray());
    }
    instanced.thinInstanceSetBuffer('matrix', Float32Array.from(matrices), 16, true);
  }
}

/**
 * The material slot of a mesh's material index: the slot of the mesh's material that holds the geometry's material of
 * that index (its IR key, `MA:Sea`), by name, else the index itself.
 * @param {Mesh} target
 * @param {({ id: string } | null)[]} [materials]
 */
const slotOf = (target, materials) => (/** @type {number} */ index) => {
  const id = materials?.[index]?.id, slots = /** @type {any} */ (target.material)?.subMaterials;
  const at = id && slots ? slots.findIndex((/** @type {any} */ m) => m?.name === id.slice(id.indexOf(':') + 1)) : -1;
  return at < 0 ? index : at;
};
