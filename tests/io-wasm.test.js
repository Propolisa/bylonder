// File > Import and File > Export: Blender's own importers and exporters in the module, run from Blender's menus
// through the file dialogs (wm-fileselect.js, a test chooser in place of the browser's), checked against Blender 5.2.3
// (tools/blender-reference/io-fixtures.py): files Blender exported import as Blender imports them (objects, counts,
// bounds, UV maps, color attributes, normals, materials), the module's exports of Blender's own scene import as
// Blender's exports of it do, and what an import makes is drawn by the view with its UVs, normals and materials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, VertexBuffer } from '@babylonjs/core';
import { blenderMain, blenderModule, hasOperator } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { setContextPointer, blendData } from '../src/python/bpy_rna.js';
import { createTopbarArea } from '../src/editors/space_topbar/topbar-area.js';
import { loadKeyconfig } from '../src/windowmanager/wm-window.js';
import { setFileChooser, setFileselectHost } from '../src/windowmanager/wm-fileselect.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createCurveObjects } from '../src/editors/curve/curve-objects.js';
import '../src/editors/io/io-ops.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/io/${name}`, import.meta.url)));
const reference = JSON.parse(new TextDecoder().decode(fixture('io-import.json')));
const FORMATS = { obj: ['suzanne.obj', 'wm.obj_import', 'wm.obj_export'], ply: ['suzanne.ply', 'wm.ply_import', 'wm.ply_export'],
  stl: ['suzanne.stl', 'wm.stl_import', 'wm.stl_export'], fbx: ['suzanne.fbx', 'wm.fbx_import'] };

const main = blenderMain();
setContextPointer(main.C);
loadKeyconfig(main.C);
main.undoInit();
globalThis.innerWidth ??= 1200;
const topbar = createTopbarArea(main, null);

// Main's objects as io-fixtures.py summarizes Blender's, through Blender's RNA in the module.
const rounded = (values, digits = 4) => [...values].map((v) => Number(v.toFixed(digits)) || 0);
function summary(ob) {
  const mesh = ob.data, m = [...ob.matrix_world];
  // matrix_world iterates column by column.
  const world = [...mesh.vertices].map(({ co: [x, y, z] }) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]));
  const uvs = [...mesh.uv_layers];
  return {
    name: ob.name, vertices: mesh.vertices.length, edges: mesh.edges.length, faces: mesh.polygons.length, corners: mesh.loops.length,
    bounds: [rounded([0, 1, 2].map((i) => Math.min(...world.map((p) => p[i])))), rounded([0, 1, 2].map((i) => Math.max(...world.map((p) => p[i]))))],
    location: rounded(ob.location), rotation: rounded(ob.rotation_euler),
    uv_layers: uvs.map((layer) => layer.name),
    uv_bounds: uvs.map((layer) => { const uv = [...layer.data].map((d) => d.uv); return rounded([0, 1].map((i) => Math.min(...uv.map((p) => p[i])))).concat(rounded([0, 1].map((i) => Math.max(...uv.map((p) => p[i]))))); }),
    color_attributes: [...mesh.color_attributes].map((a) => [a.name, a.domain, a.data_type]),
    smooth_faces: [...mesh.polygons].filter((f) => f.use_smooth).length,
    custom_normals: mesh.has_custom_normals,
    corner_normals: Number([...mesh.corner_normals].reduce((sum, { vector: [x, y, z] }) => sum + x + 2 * y + 3 * z, 0).toFixed(3)),
    materials: [...mesh.materials].map((m) => m?.name ?? null),
  };
}
const objects = () => [...blendData().objects].sort((a, b) => (a.name < b.name ? -1 : 1));
// What an import made, as Blender's import of the same file (names aside: the importers name objects by file).
function assertImported(kind, made) {
  const expected = reference.imports[kind];
  assert.equal(made.length, expected.length, `${kind}: objects`);
  made.forEach((ob, i) => {
    // Through JSON, as Blender's -0 reads back 0.
    const { name, corner_normals, ...rest } = JSON.parse(JSON.stringify(expected[i])), got = summary(ob);
    assert.deepEqual({ ...got, name: undefined, corner_normals: undefined }, { ...rest, name: undefined, corner_normals: undefined }, `${kind}: ${name} as Blender imports it`);
    assert.ok(Math.abs(got.corner_normals - corner_normals) < 0.05, `${kind}: normals ${got.corner_normals} as Blender's ${corner_normals}`);
  });
}

// Runs a File menu entry as a click does; resolves once the file dialog answered and the operator ran, with whether it
// pushed an undo step.
const entry = (menu, label) => topbar.items(menu).find((item) => item.label === label);
function runEntry(menu, label, chooser) {
  return new Promise((resolve, reject) => {
    setFileChooser({ options: async () => true, ...chooser });
    setFileselectHost((run) => { const step = main.undoStep; run(); resolve(main.undoStep !== step); });
    const item = entry(menu, label);
    if (!item?.enabled()) reject(Error(`${menu} > ${label} does not run`));
    else item.run({ clientX: 10, clientY: 10 });
  });
}
const importFile = (label, files) => runEntry('TOPBAR_MT_file_import', label, { open: async () => ({ files }) });
function exportFile(label, name) {
  const written = {};
  return runEntry('TOPBAR_MT_file_export', label, {
    save: async () => ({ name, save: (bytes) => { written[name] = bytes; } }),
    download: (file, bytes) => { written[file] = bytes; },
  }).then(async () => { await new Promise((done) => setTimeout(done)); return written; });
}
const LABELS = { obj: 'Wavefront (.obj)', ply: 'Stanford PLY (.ply)', stl: 'STL (.stl)', fbx: 'FBX (.fbx)' };
// An empty scene: Blender's file, its objects deleted.
function clear() {
  main.readBlend(fixture('suzanne.blend'));
  main.run('object.select_all', { action: 'SELECT' });
  main.run('object.delete', {});
  main.run('outliner.orphans_purge', { do_recursive: true });
}

// Files Blender exported, imported through File > Import as Blender imports them.
for (const [kind, [file, idname]] of Object.entries(FORMATS)) {
  if (!hasOperator(idname)) { console.log(`${idname} is not in this module`); continue; }
  clear();
  assert.equal(objects().length, 0);
  const files = [[file, fixture(file)], ...(kind === 'obj' ? [['suzanne.mtl', fixture('suzanne.mtl')]] : [])];
  assert.ok(await importFile(LABELS[kind], files), `${idname} pushed an undo step`);
  assertImported(kind, objects());
}

// Blender's own scene (suzanne.blend) exported by the module through File > Export, then imported again, makes what
// Blender's export of it imports as; the OBJ is Blender's own file, line for line.
for (const [kind, [file, idname, exporter]] of Object.entries(FORMATS)) {
  if (!exporter) continue;
  main.readBlend(fixture('suzanne.blend'));
  const written = await exportFile(LABELS[kind], file);
  assert.ok(written[file]?.length, `${exporter} wrote ${file}`);
  if (kind === 'obj') {
    assert.ok(written['suzanne.mtl'], 'with its .mtl beside it');
    const text = (bytes) => new TextDecoder().decode(bytes).split('\n').filter((line) => !line.startsWith('#'));
    assert.deepEqual(text(written[file]), text(fixture(file)), 'the OBJ is the one Blender writes');
  }
  clear();
  await importFile(LABELS[kind], Object.entries(written));
  assertImported(kind, objects());
}

// A menu entry calls a module operator the page does not register through Blender (bpy_operator_call), which owns the
// operator's reports: 100 calls, each cancelled in its file dialog, leave the heap whole for the depsgraph after.
{
  main.readBlend(fixture('suzanne.blend'));
  setFileChooser({ options: async () => true, save: async () => null });
  for (let i = 0; i < 100; i++) {
    entry('TOPBAR_MT_file_export', LABELS.stl).run({ clientX: 10, clientY: 10 });
    await new Promise((done) => setTimeout(done));
  }
  main.evaluate();
  assert.equal(objects().length, 1, 'Main is intact after 100 calls');
}

// The corner normals kept beside an extraction's header are freed with it: 1000 modifier objects evaluated and freed
// leave none behind.
{
  const x = blenderModule.exports, kept = x.extraction_corner_normals_count();
  for (let i = 0; i < 1000; i++) {
    const mo = x.modifier_object_new();
    x.modifier_object_eval(mo);
    x.modifier_object_free(mo);
  }
  assert.equal(x.extraction_corner_normals_count(), kept);
}

// An import drawn by the view (main-view.js) of a world over this Main: Babylon's mesh has the UVs, Blender's corner
// normals and the material.
{
  clear();
  const scene = new Scene(new NullEngine());
  const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(main) });
  const world = { scene, objects: Object.assign([], { scene }), animation };
  let camera = null;
  world.sceneSettings = createSceneSettings(world, { cameras: { list: () => scene.cameras, get: () => camera, set: (c) => { camera = c; } } });
  world.renderSettings = createRenderSettings(world);
  world.collections = createCollections(world);
  world.materials = createMaterialLibrary(world);
  world.worlds = createWorlds(world);
  world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
  world.curves = createCurveObjects(world);
  registerObjects(animation, world.objects);
  const sync = createMainSync({ rna: createRNA({ world, selection: createSelection(scene, world.objects) }), ids: animation.ids });
  await importFile(LABELS.obj, [['suzanne.obj', fixture('suzanne.obj')], ['suzanne.mtl', fixture('suzanne.mtl')]]);
  sync.view();
  const node = world.objects.find((n) => n.name === 'Suzanne');
  assert.ok(node, 'the view makes the imported object');
  const corners = reference.imports.obj[0].corners, normals = node.getVerticesData(VertexBuffer.NormalKind);
  assert.equal(node.getTotalVertices(), corners);
  assert.equal(node.getVerticesData(VertexBuffer.UVKind)?.length, corners * 2, 'with its UV map');
  // Babylon's (x, y, z) is Blender's (x, z, y).
  let sum = 0;
  for (let c = 0; c < corners; c++) sum += normals[c * 3] + 2 * normals[c * 3 + 2] + 3 * normals[c * 3 + 1];
  assert.ok(Math.abs(sum - reference.imports.obj[0].corner_normals) < 0.05, `with Blender's corner normals (${sum.toFixed(3)})`);
  assert.equal(node.material?.name, 'Skin', 'and its material');
}
console.log(`File > Import and Export: ${Object.keys(FORMATS).filter((k) => hasOperator(FORMATS[k][1])).join(', ')} as Blender 5.2 imports and exports them`);
