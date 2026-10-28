// The modifier kernels polyfill's evaluation: Blender's modifier stack (modifier-api.cc in modifiers.wasm) on an
// exported base Mesh, drawn as Bylonder draws it (mesh_batch_cache_vertex_buffers), so a live result is the applied
// export's geometry.
import { moduleMesh } from '../../bmesh/module-mesh.js';
import { writeValues } from '../../modifiers/dna-write.js';
import { mesh_batch_cache_vertex_buffers } from '../../draw/mesh-batch-buffers.js';

// An extracted Mesh needs only its attributes here, not the app's Mesh with its derived data.
const extractionMesh = () => {
  const mesh = { attribute: (name) => mesh.attributes.get(name)?.data };
  return mesh;
};

// base: { vert_positions, edges, face_offsets, corner_verts, corner_edges, uvs } typed arrays; stack: [{ type, layouts,
// values }]. Gives the draw buffers, owned by the caller.
export function createEvaluator(exports) {
  const { evaluateModifiers } = moduleMesh(exports, extractionMesh);
  return (base, stack) => {
    const mesh = {
      ...base,
      verts_num: base.vert_positions.length / 3, edges_num: base.edges.length / 2, faces_num: base.face_offsets.length - 1,
      attribute: (name) => (name === 'UVMap' ? base.uvs : undefined),
    };
    const modifiers = stack.map(({ type, layouts, values }) => ({ type, write: (view, address) => writeValues(view, address, layouts, values) }));
    const { mesh: result, errors } = evaluateModifiers(mesh, modifiers);
    const error = errors.find(Boolean);
    if (error) throw new Error(error);
    const { positions, normals, indices, uvs } = mesh_batch_cache_vertex_buffers(result);
    return { positions, normals, indices: indices.slice(), ...(uvs && { uvs: uvs.slice() }) };
  };
}
