// Mesh data from Babylon geometry, for meshes built by project code or Babylon's builders. Babylon splits vertices
// along normal and UV seams; corners at the same position weld back into one vertex. Positions return to Blender's
// axes ((x, y, z) from Babylon's (x, z, y)), triangles stay triangles, and faces Babylon shades smoothly stay smooth.
import { BM_mesh_create, BM_ELEM_SMOOTH, poolLayerAdd, poolLayer } from '../../bmesh/intern/bmesh-class.js';
import { BM_vert_create, BM_face_create_verts, BM_CREATE_NOP } from '../../bmesh/intern/bmesh-core.js';
import { BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';

const WELD_PRECISION = 1e5;

export function mesh_from_vertex_data({ positions, indices, normals, uvs }) {
  const bm = BM_mesh_create();
  const uv = uvs ? poolLayerAdd(bm.l, 'UVMap', Float32Array, 2) : null;
  const welded = new Map(), vertOf = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const co = [positions[i * 3], positions[i * 3 + 2], positions[i * 3 + 1]];
    const key = co.map((x) => Math.round(x * WELD_PRECISION)).join(',');
    if (!welded.has(key)) welded.set(key, BM_vert_create(bm, co));
    vertOf.push(welded.get(key));
  }
  const faceKeys = new Set();
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]], verts = corners.map((c) => vertOf[c]);
    const key = [...verts].sort((a, b) => a - b).join(',');
    if (new Set(verts).size < 3 || faceKeys.has(key)) continue;
    faceKeys.add(key);
    const f = BM_face_create_verts(bm, verts, verts.length, -1, BM_CREATE_NOP, true);
    if (normals && isSmooth(normals, corners)) bm.f.hflag[f] |= BM_ELEM_SMOOTH;
    let l = bm.f.l_first[f];
    for (const c of corners) {
      if (uv) uv.data.set([uvs[c * 2], uvs[c * 2 + 1]], l * 2);
      l = bm.l.next[l];
    }
  }
  return BM_mesh_bm_to_me(bm);
}

// A triangle is smooth when Babylon gave its corners different normals.
function isSmooth(normals, corners) {
  const [a, ...rest] = corners.map((c) => [normals[c * 3], normals[c * 3 + 1], normals[c * 3 + 2]]);
  return rest.some((n) => Math.abs(n[0] - a[0]) + Math.abs(n[1] - a[1]) + Math.abs(n[2] - a[2]) > 1e-4);
}
