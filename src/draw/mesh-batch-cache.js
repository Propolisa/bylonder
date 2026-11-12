// Mesh to Babylon geometry (draw_cache_impl_mesh.cc, mesh_extractors). Babylon vertices are Blender face corners;
// triangles come from corner_tris. Mesh data is in Blender's axes (Z up, right-handed); this is the one place it
// meets Babylon's (Y up, left-handed): (x, y, z) becomes (x, z, y), here or in the module for Blender's draw buffers
// (draw-mesh.cc). Swapping axes also flips handedness, so
// Blender's counter-clockwise faces stay front facing in Babylon with their winding unchanged.
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { mesh_batch_cache_vertex_buffers } from './mesh-batch-buffers.js';
import { DRAW_LINES, DRAW_TANGENTS } from '../bmesh/bmesh-wasm.js';
import { attributeKind, meshAttributes, TANGENT_KIND } from '../nodes/blender/attributes.js';
import { fillMissingAttributes } from '../overrides/webgpu/missing-attributes.js';

// VertexData's field of each vertex buffer kind it can hold.
const BUFFERS = { [VertexBuffer.PositionKind]: 'positions', [VertexBuffer.NormalKind]: 'normals', [VertexBuffer.UVKind]: 'uvs', [VertexBuffer.ColorKind]: 'colors', [VertexBuffer.TangentKind]: 'tangents' };
const babylonPoint = (p, v) => new Vector3(p[v * 3], p[v * 3 + 2], p[v * 3 + 1]);
// Object Mode wire color of Blender's default theme.
const WIRE = Color3.Black();

export const mesh_batch_cache_vertex_data = (mesh) => Object.assign(new VertexData(), mesh_batch_cache_vertex_buffers(mesh));

// One submesh per material slot its faces use (a MultiMaterial's index), else one for all: a single submesh would keep
// its old index count when an edit changes the topology.
function setSubMeshes(babylonMesh, groups) {
  if (!babylonMesh.subMeshes) return;
  if (!groups) return babylonMesh._createGlobalSubMesh(true);
  babylonMesh.subMeshes = [];
  const vertices = babylonMesh.getTotalVertices();
  for (const { slot, start, count } of groups) new SubMesh(slot, 0, vertices, start, count, babylonMesh);
}

// The bounding box, for the mesh and its one submesh (which picking tests), from the Mesh's own bounds: Babylon's
// refresh reads the vertex buffer back.
function setBounds(mesh, babylonMesh) {
  const bounds = mesh.bounds_min_max();
  if (!bounds || babylonMesh.subMeshes?.length > 1) return babylonMesh.refreshBoundingInfo();
  const corner = ([x, y, z]) => new Vector3(x, z, y), box = () => new BoundingInfo(corner(bounds.min), corner(bounds.max));
  babylonMesh.setBoundingInfo(box());
  babylonMesh.subMeshes?.[0]?.setBoundingInfo(box());
}

// Each object's face edges as pairs of its Babylon vertices (face corners), for Wireframe shading: Blender draws a
// mesh's edges, not the triangles its faces are drawn with.
const faceEdges = new WeakMap();

function face_edge_corners(mesh) {
  const { face_offsets } = mesh, lines = new Uint32Array(mesh.corners_num * 2);
  for (let f = 0; f < mesh.faces_num; f++) {
    const start = face_offsets[f], end = face_offsets[f + 1];
    for (let c = start; c < end; c++) { lines[c * 2] = c; lines[c * 2 + 1] = c + 1 < end ? c + 1 : start; }
  }
  return lines;
}

// The edges Wireframe shading draws for a Babylon mesh as vertex index pairs: its Mesh's face edges, or for geometry
// Babylon built, its triangles' edges.
export function mesh_batch_cache_wire_indices(babylonMesh) {
  if (faceEdges.has(babylonMesh)) return faceEdges.get(babylonMesh);
  const tris = babylonMesh.getIndices() ?? [], lines = new Uint32Array(tris.length * 2);
  for (let t = 0; t < tris.length; t += 3) for (let i = 0; i < 3; i++) { lines[(t + i) * 2] = tris[t + i]; lines[(t + i) * 2 + 1] = tris[t + (i + 1) % 3]; }
  return lines;
}

// The triangles' edges with the corners opposite them (extract_mesh_ibo_lines_adjacency.cc): four Babylon vertices
// per edge, the opposite corner of one triangle, the edge's two corners, the opposite corner of the other. Vertices at
// the same position are one vertex, as Babylon splits Blender's vertices into face corners. An edge with one triangle,
// or with triangles of mismatched winding, repeats the triangle's own corner.
export function mesh_batch_cache_edge_detection(babylonMesh) {
  const tris = babylonMesh.getIndices() ?? [], p = babylonMesh.getVerticesData('position') ?? [];
  const welded = new Map(), vert = new Uint32Array(p.length / 3);
  for (let c = 0; c < vert.length; c++) {
    const key = p[c * 3] + ',' + p[c * 3 + 1] + ',' + p[c * 3 + 2];
    if (!welded.has(key)) welded.set(key, welded.size);
    vert[c] = welded.get(key);
  }
  const HANDLED = -1, edges = new Map(), vertToCorner = new Uint32Array(welded.size), out = [];
  const add = (a, b, c, d) => out.push(a, b, c, d);
  for (let t = 0; t < tris.length; t += 3) {
    const corner = [tris[t], tris[t + 1], tris[t + 2]];
    for (let e = 0; e < 3; e++) {
      corner.unshift(corner.pop());
      const v1 = vert[corner[1]], v2 = vert[corner[2]], inv = v1 > v2, key = inv ? v2 * welded.size + v1 : v1 * welded.size + v2;
      const value = edges.get(key);
      if (value === undefined) {
        edges.set(key, inv ? -(corner[0] + 1) : corner[0] + 1);
        vertToCorner[v1] = corner[1];
        vertToCorner[v2] = corner[2];
      } else if (value !== HANDLED) {
        edges.set(key, HANDLED);
        const opposite = Math.abs(value) - 1;
        if ((value < 0) === inv) {
          add(corner[0], corner[1], corner[2], corner[0]);
          add(opposite, corner[1], corner[2], opposite);
        } else add(corner[0], corner[1], corner[2], opposite);
      }
    }
  }
  for (const [key, value] of edges) {
    if (value === HANDLED) continue;
    let v2 = Math.floor(key / welded.size), v3 = key % welded.size;
    if (value < 0) [v2, v3] = [v3, v2];
    add(Math.abs(value) - 1, vertToCorner[v2], vertToCorner[v3], Math.abs(value) - 1);
  }
  return Uint32Array.from(out);
}

// Faces become the mesh's geometry, from Blender's draw buffers where the Mesh has them (an evaluated Mesh of Main's,
// extracted in the module), else built here; loose edges a line child that picks as its owner.
export function mesh_batch_cache_apply(mesh, babylonMesh) {
  babylonMesh.makeGeometryUnique?.();
  const read = meshAttributes(babylonMesh);
  const buffers = mesh.drawBuffers?.(DRAW_LINES | (read.tangents ? DRAW_TANGENTS : 0), read.names);
  setSubMeshes(babylonMesh, buffers ? drawn(babylonMesh, buffers, read.names) : built(babylonMesh, mesh));
  removeMismatched(babylonMesh);
  fillMissingAttributes(babylonMesh, read.names.map(attributeKind));
  babylonMesh.getChildMeshes(true).filter((child) => child.metadata?.drawOwner === babylonMesh).forEach((child) => child.dispose());
  const loose = mesh.loose_edges();
  if (loose.length) {
    const p = mesh.vert_positions, lines = Array.from(loose, (e) => [babylonPoint(p, mesh.edges[e * 2]), babylonPoint(p, mesh.edges[e * 2 + 1])]);
    const wire = CreateLineSystem(babylonMesh.name + ' loose edges', { lines }, babylonMesh.getScene());
    wire.color = WIRE;
    // Babylon's own material for it is no scene material: Main must not take it in (a '__' name, material/library.js).
    wire.material.name = '__' + wire.name;
    wire.parent = babylonMesh;
    wire.intersectionThreshold = 0.05;
    wire.metadata = { drawOwner: babylonMesh };
  }
  setBounds(mesh, babylonMesh);
}

// The geometry of a Mesh's draw buffers built here (mesh-batch-buffers.js); its material groups.
function built(babylonMesh, mesh) {
  const data = mesh_batch_cache_vertex_data(mesh);
  removeOthers(babylonMesh, (kind) => data[BUFFERS[kind]]);
  data.applyToMesh(babylonMesh, true);
  faceEdges.set(babylonMesh, face_edge_corners(mesh));
  return data.groups;
}

// A per-corner buffer copied out for every Babylon vertex: the points of loose edges and vertices, which come after the
// face corners, have no corner, so they get zeros.
function perVertex(data, size, vertices) {
  const full = new data.constructor(vertices * size);
  full.set(data.subarray(0, full.length));
  return full;
}

// The geometry of Blender's draw buffers (bmesh-wasm.js drawBuffers), copied out of the module's memory, with the
// attributes its materials read by `names`; its material groups, by the triangles of each slot.
function drawn(babylonMesh, { positions, normals, uvs, tris, lines, tangents, attributes, tris_by_material: counts, free }, names) {
  const kinds = [VertexBuffer.PositionKind, VertexBuffer.NormalKind, ...(uvs ? [VertexBuffer.UVKind] : [])];
  removeOthers(babylonMesh, (kind) => kinds.includes(kind));
  babylonMesh.setVerticesData(VertexBuffer.PositionKind, positions.slice(), false);
  babylonMesh.setVerticesBuffer(new VertexBuffer(babylonMesh.getEngine(), normals.slice(), VertexBuffer.NormalKind,
    { size: 3, stride: 4, type: VertexBuffer.SHORT, normalized: true }));
  const vertices = positions.length / 3;
  if (uvs) babylonMesh.setVerticesData(VertexBuffer.UVKind, perVertex(uvs, 2, vertices), false);
  const engine = babylonMesh.getEngine(), attribute = (kind, { data, size, normalized }) => babylonMesh.setVerticesBuffer(new VertexBuffer(engine, perVertex(data, size, vertices), kind,
    { size, type: data instanceof Uint16Array ? VertexBuffer.UNSIGNED_SHORT : data instanceof Int16Array ? VertexBuffer.SHORT : VertexBuffer.FLOAT, normalized }));
  if (tangents) attribute(TANGENT_KIND, { data: tangents, size: 4, normalized: true });
  attributes.forEach((read, i) => read && attribute(attributeKind(names[i]), read));
  babylonMesh.setIndices(tris.slice(), vertices);
  faceEdges.set(babylonMesh, lines.slice());
  free();
  if (counts.length < 2) return null;
  let start = 0;
  return counts.flatMap((tris, slot) => (tris ? [{ slot, start: (start += tris * 3) - tris * 3, count: tris * 3 }] : []));
}

// A buffer the new geometry does not have goes (a UV map an evaluation left out), so every buffer has its vertex count.
// Vertex buffers of an earlier topology (an attribute a built mesh does not draw), which no longer hold a value per
// vertex: left, they would be read past their end.
function removeMismatched(babylonMesh) {
  const vertices = babylonMesh.getTotalVertices();
  for (const kind of babylonMesh.getVerticesDataKinds?.() ?? []) {
    const buffer = babylonMesh.getVertexBuffer(kind), data = buffer.getData();
    if (buffer.getIsInstanced() || !data) continue;
    const bytes = ArrayBuffer.isView(data) || data instanceof ArrayBuffer ? data.byteLength : data.length * 4;
    if ((bytes - buffer.byteOffset) / buffer.byteStride < vertices) babylonMesh.removeVerticesData(kind);
  }
}
function removeOthers(babylonMesh, kept) {
  for (const kind of babylonMesh.getVerticesDataKinds?.() ?? []) if (BUFFERS[kind] && !kept(kind)) babylonMesh.removeVerticesData(kind);
}
