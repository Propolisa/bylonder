// A module's memory and the Meshes it extracts (ExtractionHeader, extraction.hh), and Blender's modifier stack on a
// Mesh (modifier-api.cc): shared by the scene module (bmesh-wasm.js) and the modifier kernels module, given its exports
// and how a Mesh is made in its realm.
// The boolean attributes Blender's edit mode reads and writes, in bmesh-api.cc's MeshFlag order, with their domains.
export const FLAGS = [['.select_vert', 'POINT'], ['.hide_vert', 'POINT'], ['.select_edge', 'EDGE'], ['.hide_edge', 'EDGE'], ['.uv_seam', 'EDGE'],
  ['sharp_edge', 'EDGE'], ['.select_poly', 'FACE'], ['.hide_poly', 'FACE'], ['sharp_face', 'FACE']];

export function moduleMesh(x, createMesh) {
  // Copies arrays into module memory (null stays a null pointer), runs fn with their pointers, and frees them.
  function withArrays(arrays, fn) {
    const pointers = arrays.map((a) => {
      if (!a) return 0;
      const p = x.malloc(a.byteLength) >>> 0;
      new a.constructor(x.memory.buffer, p, a.length).set(a);
      return p;
    });
    try {
      return fn(pointers);
    } finally {
      pointers.forEach((p) => p && x.free(p));
    }
  }
  // A WebAssembly pointer is an unsigned 32-bit address; exports return it as a signed int.
  const cString = (pointer) => {
    const bytes = new Uint8Array(x.memory.buffer, pointer >>> 0);
    return new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(0)));
  };
  const withString = (text, fn) => withArrays([new TextEncoder().encode(text + '\0')], ([pointer]) => fn(pointer));
  const bytes = (data) => data && Uint8Array.from(data, Boolean);

  const meshArrays = (mesh) => [Float32Array.from(mesh.vert_positions), Int32Array.from(mesh.edges), Int32Array.from(mesh.face_offsets),
    Int32Array.from(mesh.corner_verts), Int32Array.from(mesh.corner_edges), mesh.attribute('UVMap') && Float32Array.from(mesh.attribute('UVMap'))];

  // The Mesh of an extraction (ExtractionHeader): counts, then buffer pointers. Its arrays are views made again when the
  // module's memory grows, which detaches the old ones. detach() copies them out, for attachedMesh in another realm.
  function extractedMesh(header) {
    const words = Array.from(new Uint32Array(x.memory.buffer, header, 5 + 10 + FLAGS.length + 3));
    const counts = words.slice(0, 5), [verts, edges, faces, corners, tris] = counts, at = (i) => words[5 + i];
    const sizes = { POINT: verts, EDGE: edges, FACE: faces };
    const layout = {
      vert_positions: [Float32Array, at(0), verts * 3], vert_normals: [Float32Array, at(1), verts * 3], face_normals: [Float32Array, at(2), faces * 3],
      edges: [Int32Array, at(3), edges * 2], face_offsets: [Int32Array, at(4), faces + 1], corner_verts: [Int32Array, at(5), corners],
      corner_edges: [Int32Array, at(6), corners], corner_tris: [Int32Array, at(7), tris * 3], tri_faces: [Int32Array, at(8), tris],
      UVMap: [Float32Array, at(9), corners * 2],
      ...Object.fromEntries(FLAGS.map(([name, domain], i) => [name, [Uint8Array, at(10 + i), sizes[domain]]])),
      ...Object.fromEntries(['POINT', 'EDGE', 'FACE'].map((domain, i) => [`orig_index_${domain}`, [Int32Array, at(10 + FLAGS.length + i), sizes[domain]]])),
    };
    let buffer = null, views = {};
    const view = (name) => {
      if (buffer !== x.memory.buffer) [buffer, views] = [x.memory.buffer, {}];
      const [Type, pointer, length] = layout[name];
      // A mesh without faces may have no offsets array; its one offset is 0.
      return (views[name] ??= pointer ? new Type(buffer, pointer, length) : new Type(length));
    };
    const present = Object.keys(layout).filter((name) => layout[name][1]);
    const mesh = meshOfBuffers(counts, present, view);
    mesh.detach = () => ({ counts, buffers: Object.fromEntries(present.map((name) => [name, view(name).slice()])) });
    return mesh;
  }

  // A detached extraction ({counts, buffers}) as the Mesh it was.
  const attachedMesh = ({ counts, buffers }) => meshOfBuffers(counts, Object.keys(buffers), (name) => buffers[name]);

  // The Mesh of an extraction's counts and the buffers present in it, read through buffer(name).
  function meshOfBuffers([verts, edges, faces, corners], present, buffer) {
    const has = (name) => present.includes(name);
    const mesh = createMesh({});
    for (const name of ['vert_positions', 'edges', 'face_offsets', 'corner_verts', 'corner_edges']) Object.defineProperty(mesh, name, { get: () => buffer(name) });
    Object.defineProperties(mesh, { verts_num: { value: verts }, edges_num: { value: edges }, faces_num: { value: faces }, corners_num: { value: corners } });
    const attribute = (name, domain, type) => [name, { domain, type, get data() { return buffer(name); } }];
    mesh.attributes = new Map([...FLAGS.filter(([name]) => has(name)).map(([name, domain]) => attribute(name, domain, 'BOOLEAN')),
      ...(has('UVMap') ? [attribute('UVMap', 'CORNER', 'FLOAT2')] : [])]);
    Object.assign(mesh, {
      corner_tris: () => buffer('corner_tris'),
      corner_tri_faces: () => buffer('tri_faces'),
      face_normals: () => buffer('face_normals'),
      vert_normals: () => buffer('vert_normals'),
      // An evaluated mesh's original element of each of its own in a domain (CD_ORIGINDEX, -1 for none), or null.
      orig_index: (domain) => (has(`orig_index_${domain}`) ? buffer(`orig_index_${domain}`) : null),
    });
    return mesh;
  }

  // Gives a module Object the modifier stack: each modifier is its type (ModifierType) and a function that writes its
  // settings into its ModifierData, given a DataView of the module's memory and the struct's address. Returns their
  // ModifierData and a function reading each one's error from its last evaluation, or null.
  function setModifiers(object, modifiers) {
    x.modifier_clear(object);
    const added = modifiers.map(({ type, write }) => {
      const md = x.modifier_add(object, type) >>> 0;
      if (!md) throw new Error(`Modifier type ${type} is not in this WebAssembly module`);
      write(new DataView(x.memory.buffer), md);
      return md;
    });
    return { added, errors: () => added.map((md) => (x.modifier_error(md) ? cString(x.modifier_error(md)) : null)) };
  }

  // Blender's modifier stack on an object's Mesh (modifier-api.cc), as setModifiers takes it. Returns the evaluated Mesh,
  // whose arrays are valid until the next evaluation, and each modifier's error or null.
  function evaluateModifiers(mesh, modifiers) {
    withArrays(meshArrays(mesh), ([p, e, f, cv, ce, uv]) =>
      x.modifier_object_mesh_set(modifierObject(), mesh.verts_num, p, mesh.edges_num, e, mesh.faces_num, f, cv, ce, uv));
    const { errors } = setModifiers(x.modifier_object(modifierObject()), modifiers);
    return { mesh: extractedMesh(x.modifier_object_eval(modifierObject()) >>> 0), errors: errors() };
  }

  // The one module Object modifier stacks are evaluated on.
  let object = 0;
  const modifierObject = () => (object ||= x.modifier_object_new());

  return { withArrays, cString, withString, bytes, meshArrays, extractedMesh, attachedMesh, setModifiers, evaluateModifiers, modifierObject };
}
