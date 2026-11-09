// The modifier kernels polyfill's evaluation: one of Blender's mesh modifiers (modifier-api.cc in modifiers.wasm) on an
// IR mesh, giving an IR mesh, or drawn as Bylonder draws it (mesh_batch_cache_vertex_buffers) so a live result is the
// applied export's geometry.
import { moduleMesh } from '../../bmesh/module-mesh.js';
import { writeValues } from '../../modifiers/dna-write.js';
import { mesh_batch_cache_vertex_buffers } from '../../draw/mesh-batch-buffers.js';

// An extracted Mesh needs only its attributes here, not the app's Mesh with its derived data.
const extractionMesh = () => {
  const mesh = { attribute: (name) => mesh.attributes.get(name)?.data };
  return mesh;
};

// mesh: an IR mesh of typed arrays; modifier: { type, layouts, values }, or null to draw the mesh as it is. Gives an IR
// mesh, or with `draw` the draw buffers, owned by the caller.
export function createEvaluator(exports) {
  const { evaluateModifiers } = moduleMesh(exports, extractionMesh);
  return ({ mesh: ir, modifier, draw }) => {
    const mesh = {
      ...ir,
      verts_num: ir.vert_positions.length / 3, edges_num: ir.edges.length / 2, faces_num: ir.face_offsets.length - 1,
      attribute: (name) => (name === 'UVMap' ? ir.uvs : undefined),
    };
    const modifiers = modifier ? [{ type: modifier.type, write: (view, address) => writeValues(view, address, modifier.layouts, modifier.values) }] : [];
    const { mesh: result, errors } = evaluateModifiers(mesh, modifiers);
    const error = errors.find(Boolean);
    if (error) throw new Error(error);
    const uvs = result.attribute('UVMap');
    if (!draw) {
      const copy = (name) => result[name].slice();
      return { vert_positions: copy('vert_positions'), edges: copy('edges'), face_offsets: copy('face_offsets'), corner_verts: copy('corner_verts'),
        corner_edges: copy('corner_edges'), ...(uvs && { uvs: uvs.slice() }) };
    }
    const { positions, normals, indices } = mesh_batch_cache_vertex_buffers(result);
    return { positions, normals, indices: indices.slice(), ...(uvs && { uvs: uvs.slice() }) };
  };
}
