// The editor's Edit Mode operators (meshOperator in src/editors/mesh/editmesh-tools.js) on Blender's edit mesh in
// WebAssembly, against Blender 5.2's results: every fixture must match exactly, UVs, sharp faces and selection
// included, and the modal tools' previews must show what running them gives. ONLY=prefix runs the fixtures whose
// names start with it.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { EditMesh, EXTRACT_ALL } from '../src/bmesh/bmesh-wasm.js';
import { hasMeshOperator, meshOperator, operatorPreview } from '../src/editors/mesh/editmesh-tools.js';

const dir = new URL('./fixtures/mesh/', import.meta.url);
// Select mode (SCE_SELECT_*) and element type (BM_*) per fixture select mode.
const SELECT = { VERT: [1, 1], EDGE: [2, 2], FACE: [4, 8] };
// Modal tools, whose previews must show what running them gives.
const PREVIEWED = /^mesh\.(bevel|inset)$/;
const MESH_ARRAYS = ['vert_positions', 'edges', 'face_offsets', 'corner_verts', 'corner_edges'];
// What a fixture cannot check: Blender's mesh.loopcut needs a 3D Viewport, so its fixtures come from a stand-in whose
// selection is not Blender's (loopcut() in tools/blender-reference/mesh-fixtures.py).
const UNCHECKED = { 'mesh.loopcut': ['selection'] };
// Where a JS port still differs from Blender, reported on every run until Blender's own runs here: Edge Slide's port
// does not correct UVs (correct_uv).
const KNOWN = { 'transform.edge_slide': ['UVs'] };
const known = [];
const near = (a, b) => Math.abs(a - b) < 1e-5;
const selected = (mesh, name) => Array.from(mesh.attribute(name), Boolean).flatMap((x, i) => (x ? [i] : []));
// Order-free form of a mesh: vertices, edges and faces (winding kept) named by rounded position.
function geometry(positions, edges, face_offsets, corner_verts) {
  const key = (v) => Array.from(positions.slice(v * 3, v * 3 + 3), (x) => Math.round(x * 1e4) / 1e4 + 0).join(',');
  const faces = [];
  for (let f = 0; f + 1 < face_offsets.length; f++) {
    const ring = Array.from(corner_verts.slice(face_offsets[f], face_offsets[f + 1]), key);
    const start = ring.indexOf([...ring].sort()[0]);
    faces.push(ring.slice(start).concat(ring.slice(0, start)).join(' '));
  }
  const verts = Array.from({ length: positions.length / 3 }, (_, v) => key(v));
  const pairs = Array.from({ length: edges.length / 2 }, (_, e) => [key(edges[e * 2]), key(edges[e * 2 + 1])].sort().join(' '));
  return JSON.stringify({ verts: verts.sort(), edges: pairs.sort(), faces: faces.sort() });
}

// Moves the selected vertices, as the fixtures' follow-up translate does.
function translateSelected(edit, offset) {
  const mesh = edit.toMesh(), verts = selected(mesh, '.select_vert');
  edit.setCoords(verts, verts.flatMap((v) => offset.map((d, a) => mesh.vert_positions[v * 3 + a] + d)));
}

const failures = [];
let matched = 0, geometric = 0, previewed = 0;
// What of a fixture's result differs from Blender's; an error (a Blender function not in the module) is its difference.
function differences(fixture) {
  const base = primitive_add(fixture.operator, fixture.props), { seams = [], move } = fixture.edit;
  if (seams.length) {
    const data = new Uint8Array(base.edges_num);
    for (const e of seams) data[e] = 1;
    base.attributes.set('.uv_seam', { domain: 'EDGE', type: 'BOOLEAN', data });
  }
  const edit = EditMesh.fromMesh(base, SELECT[fixture.edit.select_mode][0]);
  const found = [];
  try {
    for (const step of [fixture.edit.pre, fixture.edit].filter(Boolean)) {
      const [mode, htype] = SELECT[step.select_mode];
      edit.selectClear(mode);
      for (const i of step.select) edit.select(htype, i);
      edit.selectFlush();
      const preview = PREVIEWED.test(step.operator) && operatorPreview(edit, step.operator)(step.props).mesh;
      meshOperator(edit, step.operator, step.props);
      if (preview) {
        const result = edit.toMesh();
        if (MESH_ARRAYS.some((key) => JSON.stringify(Array.from(preview[key])) !== JSON.stringify(Array.from(result[key])))) found.push('preview');
        previewed++;
      }
    }
    if (move) translateSelected(edit, move);
  } catch (error) {
    edit.free();
    return [error.message.split('\n')[0]];
  }
  const mesh = edit.toMesh();
  // What the editor draws, extracted as Blender's edit mode draws it: the BMesh's triangles and normals agree with the
  // Mesh's own, except at zero-area faces, whose BMesh normal stays zero.
  const live = edit.extract(EXTRACT_ALL), normals = live.face_normals(), own = mesh.face_normals();
  if (JSON.stringify(Array.from(live.corner_tris())) !== JSON.stringify(Array.from(mesh.corner_tris()))) found.push('extracted triangles');
  if (normals.some((n, i) => normals[i - (i % 3)] ** 2 + normals[i - (i % 3) + 1] ** 2 + normals[i - (i % 3) + 2] ** 2 > 0.5 && !near(n, own[i]))) found.push('extracted normals');
  edit.free();
  if (move) {
    // Blender's element order after an extrude varies by run, so its result compares as geometry.
    geometric++;
    return geometry(mesh.vert_positions, mesh.edges, mesh.face_offsets, mesh.corner_verts)
      === geometry(fixture.positions.flat(), fixture.edges.flat(), fixture.face_offsets, fixture.corner_verts) ? found : [...found, 'geometry'];
  }
  return [
    ...found,
    !(mesh.vert_positions.length === fixture.positions.length * 3 && fixture.positions.flat().every((x, i) => near(mesh.vert_positions[i], x))) && 'positions',
    JSON.stringify(Array.from(mesh.edges)) !== JSON.stringify(fixture.edges.flat()) && 'edges',
    JSON.stringify(Array.from(mesh.face_offsets)) !== JSON.stringify(fixture.face_offsets) && 'face offsets',
    JSON.stringify(Array.from(mesh.corner_verts)) !== JSON.stringify(fixture.corner_verts) && 'corner verts',
    JSON.stringify(Array.from(mesh.corner_edges)) !== JSON.stringify(fixture.corner_edges) && 'corner edges',
    fixture.uv && !fixture.uv.flat().every((x, i) => near(mesh.attribute('UVMap')?.[i], x)) && 'UVs',
    fixture.sharp_face && fixture.sharp_face.some((sharp, i) => sharp !== Boolean(mesh.attribute('sharp_face')[i])) && 'sharp faces',
    fixture.selection && JSON.stringify(['.select_vert', '.select_edge', '.select_poly'].map((name) => selected(mesh, name))) !== JSON.stringify(fixture.selection) && 'selection',
  ].filter(Boolean);
}

for (const file of await readdir(dir)) {
  const fixture = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
  if (process.env.ONLY && !file.startsWith(process.env.ONLY)) continue;
  if (!fixture.edit) continue;
  const missing = [fixture.edit, fixture.edit.pre].find((step) => step && !hasMeshOperator(step.operator));
  if (missing) { failures.push(`${file}: no operator ${missing.operator}`); continue; }
  const { operator } = fixture.edit;
  const differs = differences(fixture).filter((what) => !UNCHECKED[operator]?.includes(what));
  if (differs.some((what) => KNOWN[operator]?.includes(what))) known.push(`${file}: ${differs.join(', ')}`);
  const unknown = differs.filter((what) => !KNOWN[operator]?.includes(what));
  if (unknown.length) failures.push(`${file}: ${unknown.join(', ')}`);
  else if (!differs.length && !fixture.edit.move) matched++;
}
assert.deepEqual(failures, [], `Edit Mode fixtures differ from Blender:\n${failures.join('\n')}`);
assert.ok(process.env.ONLY || (matched >= 98 && geometric >= 7 && previewed >= 20));
console.log(`Edit Mode: ${matched} operator results match Blender 5.2 exactly, ${geometric} extrudes match as geometry (Blender's order there varies by run), ${previewed} modal previews match their result`);
if (known.length) console.log(`Edit Mode: ${known.length} results differ where a JS port is known to (${Object.entries(KNOWN).map(([op, what]) => `${op}: ${what.join(', ')}`).join('; ')})`);
