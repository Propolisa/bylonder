// File > Import and File > Export of the add-ons Blender 5.2 enables by default (glTF 2.0, FBX, Motion Capture, SVG as
// Curves), Blender's Python in the module's CPython, checked against Blender 5.2.3
// (tools/blender-reference/io-addon-fixtures.py): files Blender exported import as Blender imports them, the module's
// exports of Blender's own scene import as Blender's exports of it do, and the FBX the add-on exports imports again with
// Blender's C++ importer as Blender's does. What an import made is summarized by the same Python in both
// (io_addon_summary.py). The menus show the add-ons' rows greyed out until Python has registered them, then live.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { blendData, pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';
import { createTopbarArea } from '../src/editors/space_topbar/topbar-area.js';
import { loadKeyconfig, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';
import { blenderWindow } from '../src/windowmanager/wm-areas.js';
import { setFileChooser } from '../src/windowmanager/wm-fileselect.js';
import { startPython } from '../src/python/python.js';
import { files } from '../src/port/wasm.js';
import '../src/editors/io/io-ops.js';

const fixture = (dir, name) => new Uint8Array(readFileSync(new URL(`./fixtures/${dir}/${name}`, import.meta.url)));
const reference = JSON.parse(new TextDecoder().decode(fixture('io-addons', 'io-addons.json')));
const referenceIO = JSON.parse(new TextDecoder().decode(fixture('io', 'io-import.json')));
const SPACE_TEXT = 9;
const main = blenderMain();
setContextPointer(main.C);
loadKeyconfig(main.C);
main.undoInit();
globalThis.innerWidth ??= 1200;
const topbar = createTopbarArea(main, null);
const window = blenderWindow();
window.size = { width: 1200, height: 800 };

// The add-ons' rows (addon-menus.json, drawn by Blender's menus in the module): greyed out while Python starts, then
// theirs, in place.
const ADDON_ROWS = Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL('../src/editors/io/addon-menus.json', import.meta.url), 'utf8')))
  .map(([menu, entries]) => [menu, entries.map(([, label]) => label)]));
const rows = (menu) => topbar.items(menu).filter((item) => item.label).map(({ label, enabled, title }) => ({ label, disabled: !enabled(), tip: typeof title === 'function' ? title() : title }));
const before = Object.fromEntries(Object.keys(ADDON_ROWS).map((menu) => [menu, rows(menu)]));
for (const [menu, labels] of Object.entries(ADDON_ROWS)) {
  const shown = before[menu].slice(-labels.length);
  assert.deepEqual(shown.map(({ label }) => label), labels, `${menu} ends with the add-ons' rows`);
  assert.ok(shown.every(({ disabled, tip }) => disabled && /Starting Python/.test(tip ?? '')), `greyed out while Python starts (${JSON.stringify(shown)})`);
}
// Opening File starts Python.
topbar.items('TOPBAR_MT_file');
await startPython();
for (const [menu, labels] of Object.entries(ADDON_ROWS)) {
  const after = rows(menu);
  assert.deepEqual(after.map(({ label }) => label), before[menu].map(({ label }) => label), `${menu} keeps its rows in place`);
  assert.ok(after.slice(-labels.length).every(({ disabled }) => !disabled), `${menu}: the add-ons' rows are live`);
}

// Scripts run as the Text Editor's Run Script runs them; what they leave in the text "out" is read back.
const textArea = window.area(SPACE_TEXT);
const rect = { x: 0, y: 0, width: 1200, height: 800 };
textArea.layout(rect, { [RGN_TYPE_WINDOW]: rect });
const run = (source) => {
  const text = blendData().texts.get('script.py') ?? blendData().texts.new('script.py');
  text.from_string(source);
  pointerStruct(structFind('Area'), 0, textArea.pointer).spaces.active.text = text;
  textArea.inContext(RGN_TYPE_WINDOW, () => main.invoke('text.run_script', {}, {}));
  const out = blendData().texts.get('out');
  const value = out?.as_string();
  if (out) blendData().texts.remove(out);
  return value;
};
const SUMMARY = readFileSync(new URL('../tools/blender-reference/io_addon_summary.py', import.meta.url), 'utf8');
// The scene after `operations` (Python lines) from an empty one, summarized, or the error they raised.
const summarize = (operations) => JSON.parse(run(`import bpy, json, traceback
${SUMMARY}
try:
    data = bpy.data
    data.batch_remove([*data.objects, *data.meshes, *data.materials, *data.armatures, *data.curves, *data.actions, *data.images])
    bpy.context.scene.frame_set(1)
${operations.map((line) => `    ${line}`).join('\n')}
    result = summary()
except Exception:
    result = {"error": traceback.format_exc()}
bpy.data.texts.new("out").write(json.dumps(result))
`));

// Numbers within a tolerance (float rounding differs between builds), the rest equal.
function near(actual, expected, path = '') {
  if (typeof expected === 'number') return assert.ok(Math.abs(actual - expected) <= 2e-3 + Math.abs(expected) * 1e-4, `${path}: ${actual} != ${expected}`);
  if (expected === null || typeof expected !== 'object') return assert.equal(actual, expected, path);
  assert.deepEqual(Object.keys(actual ?? {}).sort(), Object.keys(expected).sort(), `${path}: keys`);
  for (const key of Object.keys(expected)) near(actual[key], expected[key], `${path}.${key}`);
}
const check = (label, actual, expected) => {
  assert.ok(!actual.error, `${label}: ${actual.error}`);
  near(actual, expected, label);
};

const put = (path, bytes) => files.set(path, bytes);
for (const name of ['suzanne.glb', 'suzanne.gltf', 'suzanne.bin', 'walk.bvh', 'shapes.svg']) put(`/tmp/io-addons/${name}`, fixture('io-addons', name));
put('/tmp/io-addons/suzanne.fbx', fixture('io', 'suzanne.fbx'));

// Blender's exports, imported by the add-ons as Blender imports them.
const timings = {};
const timed = (label, operations) => { const at = performance.now(); const result = summarize(operations); timings[label] = Math.round(performance.now() - at); return result; };
check('glb', timed('glb import', ['bpy.ops.import_scene.gltf(filepath="/tmp/io-addons/suzanne.glb")']), reference.glb);
check('gltf', summarize(['bpy.ops.import_scene.gltf(filepath="/tmp/io-addons/suzanne.gltf")']), reference.gltf);
check('fbx_legacy', summarize(['bpy.ops.import_scene.fbx(filepath="/tmp/io-addons/suzanne.fbx")']), reference.fbx_legacy);
check('bvh', summarize(['bpy.ops.import_anim.bvh(filepath="/tmp/io-addons/walk.bvh")']), reference.bvh);
check('svg', summarize(['bpy.ops.import_curve.svg(filepath="/tmp/io-addons/shapes.svg")']), reference.svg);

// Blender's own scene exported by the add-ons in the module, then imported: as Blender's exports of it import.
const fromBlend = (exports) => {
  main.readBlend(fixture('io', 'suzanne.blend'));
  setContextPointer(main.C);
  run(`import bpy
for ob in bpy.context.scene.objects:
    ob.select_set(True)
${exports.join('\n')}
`);
};
fromBlend(['bpy.ops.export_scene.gltf(filepath="/tmp/io-addons/out.glb", export_format="GLB")',
  'bpy.ops.export_scene.gltf(filepath="/tmp/io-addons/out.gltf", export_format="GLTF_SEPARATE")',
  'bpy.ops.export_scene.fbx(filepath="/tmp/io-addons/out.fbx")']);
assert.ok(files.has('/tmp/io-addons/out.bin'), "a .gltf's buffer is written beside it");
check('glb round trip', summarize(['bpy.ops.import_scene.gltf(filepath="/tmp/io-addons/out.glb")']), reference.glb);
check('gltf round trip', summarize(['bpy.ops.import_scene.gltf(filepath="/tmp/io-addons/out.gltf")']), reference.gltf);
// The FBX add-on's export, imported by Blender's C++ importer, as Blender's export of it imports (io-fixtures.py).
const fbx = summarize(['bpy.ops.wm.fbx_import(filepath="/tmp/io-addons/out.fbx")']);
const [blenderFbx] = referenceIO.imports.fbx;
for (const key of ['vertices', 'edges', 'faces', 'corners', 'bounds', 'uv_layers', 'smooth_faces', 'materials']) near(fbx[blenderFbx.name][key], blenderFbx[key], `fbx export.${key}`);

// Through File > Import: Blender's invoke opens the file browser, here the page's dialog giving the file.
setFileChooser({ open: async ({ filter_glob }) => (assert.match(filter_glob, /\*\.glb/), { files: [['suzanne.glb', fixture('io-addons', 'suzanne.glb')]] }), options: async () => true });
const objects = blendData().objects.length;
textArea.inContext(RGN_TYPE_WINDOW, () => main.invoke('import_scene.gltf', {}, {}));
for (let i = 0; i < 50 && blendData().objects.length === objects; i++) await new Promise((resolve) => setTimeout(resolve, 20)), window.tick();
assert.equal(blendData().objects.length, objects + 1, 'File > Import > glTF 2.0 imports the chosen file');

// A mid-size glTF: Suzanne subdivided three times, exported (as 62 976 triangles) and imported again.
run(`import bpy
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)
bpy.ops.mesh.primitive_monkey_add()
bpy.ops.object.modifier_add(type='SUBSURF')
bpy.context.object.modifiers[0].levels = 3
bpy.ops.object.modifier_apply(modifier=bpy.context.object.modifiers[0].name)
bpy.ops.export_scene.gltf(filepath="/tmp/io-addons/big.glb", export_format="GLB")
`);
const big = timed('mid-size glb import', ['bpy.ops.import_scene.gltf(filepath="/tmp/io-addons/big.glb")']);
assert.equal(big.Suzanne?.faces, 62976, 'the mid-size glTF imports whole');

console.log(`io add-ons: glTF (.glb, .gltf), FBX (Legacy) import, BVH and SVG import as Blender 5.2.3 imports them; glTF and FBX exports round-trip; ` +
  `${timings['glb import']} ms for Suzanne's .glb, ${timings['mid-size glb import']} ms for a ${(files.get('/tmp/io-addons/big.glb').length / 1e6).toFixed(1)} MB one`);
