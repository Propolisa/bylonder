// Bones as Blender's overlay draws them in Octahedral display (overlay_armature.cc; the shape is draw_cache.cc's
// bone_octahedral_verts and bone_octahedral_solid_tris): an octahedron per bone along its Y axis, placed by the matrix
// Blender evaluated (the edit bone's in Edit Mode, else the pose's) and scaled by its length, as the armature object's
// geometry, so it draws, shades and picks as any object does.
import { meshFromFaces } from '../bmesh/bmesh-wasm.js';
import { mesh_batch_cache_apply } from './mesh-batch-cache.js';

const VERTS = [[0, 0, 0], [0.1, 0.1, 0.1], [0.1, 0.1, -0.1], [-0.1, 0.1, -0.1], [-0.1, 0.1, 0.1], [0, 1, 0]];
const TRIS = [[2, 1, 0], [3, 2, 0], [4, 3, 0], [1, 4, 0], [5, 1, 2], [5, 2, 3], [5, 3, 4], [5, 4, 1]];

// A point of a bone's shape in armature space: its matrix (column-major) times the point scaled by its length.
const place = (m, length, [x, y, z]) => [0, 1, 2].map((i) => (m[i] * x + m[4 + i] * y + m[8 + i] * z) * length + m[12 + i]);

// The bone each face drawn of an armature object is part of, by the object.
const drawnBones = new WeakMap();
// The index of the bone a face (a triangle) of an armature object's drawing belongs to.
export const boneOfFace = (node, face) => drawnBones.get(node)?.[Math.floor(face / TRIS.length)] ?? -1;

// The bones of armatureDrawn (blenkernel/armature/armature.js) drawn into the armature object's Babylon mesh.
export function armature_draw(drawn, node) {
  const shown = drawn.filter((bone) => !bone.hide && !bone.pose_hide);
  drawnBones.set(node, shown.map((bone) => drawn.indexOf(bone)));
  const positions = shown.flatMap(({ matrix, length }) => VERTS.flatMap((v) => place(matrix, length, v)));
  const corners = shown.flatMap((_, b) => TRIS.flat().map((v) => b * VERTS.length + v));
  const offsets = Array.from({ length: corners.length / 3 + 1 }, (_, i) => i * 3);
  mesh_batch_cache_apply(meshFromFaces(positions, offsets, corners), node);
}
