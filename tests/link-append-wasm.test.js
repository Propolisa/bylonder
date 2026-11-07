// File > Link and File > Append: Blender's wm.link and wm.append in the module, run from Blender's File menu through the
// browser's file dialog (a test chooser) and Blender's own File Browser over the chosen library, driven by the window's
// input as a user drives it: double click an ID type, then double click a data-block to link or append it. Each result
// matches Blender 5.2.3's (tools/blender-reference/link-append-fixtures.py) for a collection, an object and a material,
// and so does Object > Library Override > Make on the linked collection. A project's .blend that links a library
// reads back with its links resolved from the project's libraries/ (blenkernel/libraries.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blenderMain, blenderModule, operatorNames } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { blendData, contextStruct, inPythonContext, pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';
import { createTopbarArea } from '../src/editors/space_topbar/topbar-area.js';
import { loadKeyconfig, configureWindow, allowOperators, RGN_TYPE_WINDOW, RGN_TYPE_UI, RGN_TYPE_TOOLS, RGN_TYPE_TOOL_PROPS, RGN_TYPE_EXECUTE } from '../src/windowmanager/wm-window.js';
import { blenderWindow, tick } from '../src/windowmanager/wm-areas.js';
import { setFileChooser, setFileselectHost } from '../src/windowmanager/wm-fileselect.js';
import { files } from '../src/port/wasm.js';
import { loadLibraries, unkeptLibraries } from '../src/blenkernel/libraries.js';
import { NullEngine, Scene } from '@babylonjs/core';
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
import { deleted } from '../src/editors/object/identity.js';

const SPACE_FILE = 5;
const fixture = (name) => new Uint8Array(readFileSync(new URL(name === 'library.blend' ? '../examples/link-append/libraries/library.blend' : `./fixtures/link-append/${name}`, import.meta.url)));
const reference = JSON.parse(new TextDecoder().decode(fixture('link-append.json')));
const x = blenderModule.exports;

const main = blenderMain();
setContextPointer(main.C);
loadKeyconfig(main.C);
main.undoInit();
globalThis.innerWidth ??= 1200;
globalThis.innerHeight ??= 800;
const topbar = createTopbarArea(main, null);
const window = blenderWindow();
window.size = { width: innerWidth, height: innerHeight };
configureWindow(window);
allowOperators(window, operatorNames().filter((idname) => idname.startsWith('file.')));

// The File Browser's regions as the page lays them out (editors/space_file/file-browser.js), in page pixels.
const rect = (x, y, width, height) => ({ x, y, width, height });
const MAIN = rect(240, 40, 480, 500);
const REGIONS = { [RGN_TYPE_WINDOW]: MAIN, [RGN_TYPE_UI]: rect(240, 0, 480, 40), [RGN_TYPE_TOOLS]: rect(0, 0, 240, 600),
  [RGN_TYPE_TOOL_PROPS]: rect(720, 0, 240, 600), [RGN_TYPE_EXECUTE]: rect(240, 540, 480, 60) };

// Where file_draw.cc drew an entry's name, in page pixels (the recording's y is up from the region's bottom).
function entryAt(area, name) {
  const drawn = area.draw(RGN_TYPE_WINDOW).draw.find((op) => op.op === 'text' && op.text === name);
  assert.ok(drawn, `the File Browser lists ${name}`);
  return [MAIN.x + drawn.at[0] + 4, MAIN.y + MAIN.height - drawn.at[1] - 4];
}
let time = 1000;
function doubleClick(area, name) {
  const at = entryAt(area, name);
  window.event('pointermove', at, {}, time += 500);
  for (let i = 0; i < 2; i++) {
    window.event('buttondown', [0, 0], {}, time += 2);
    window.event('buttonup', [0, 0], {}, time += 2);
  }
  tick();
}

// Blender's File Browser for the operator, browsed as a user does: into the ID type, then the data-block.
const browser = (folder, name) => async (op) => {
  const area = window.area(SPACE_FILE);
  x.fileselect_area_set(area.pointer, op);
  const layout = () => area.layout(rect(0, 0, 960, 600), REGIONS);
  layout();
  area.draw(RGN_TYPE_WINDOW);
  tick();
  const space = pointerStruct(structFind('Area'), 0, area.pointer).spaces.active;
  assert.equal(space.params.directory, '/libraries/library.blend/', 'the File Browser opens inside the library');
  for (const type of ['Collection', 'Material', 'Mesh', 'Object']) entryAt(area, type);
  doubleClick(area, folder);
  assert.equal(space.params.directory, `/libraries/library.blend/${folder}/`);
  doubleClick(area, name);
  assert.ok(!x.fileselect_held(main.C, op), 'a double click on the data-block runs the operator');
  area.free();
};

// File > Link... or File > Append..., with the library chosen and browsed into.
function linkAppend(label, folder, name) {
  return new Promise((resolve, reject) => {
    setFileChooser({ open: async ({ library }) => (assert.ok(library, 'the dialog picks a library'), { files: [['library.blend', fixture('library.blend')]] }), browse: browser(folder, name) });
    setFileselectHost(async (run) => { const step = main.undoStep; await run(); resolve(main.undoStep !== step); });
    const item = topbar.items('TOPBAR_MT_file').find((entry) => entry.label === label);
    if (!item?.enabled()) reject(Error(`File > ${label} does not run`));
    else item.run({ clientX: 10, clientY: 10 });
  });
}

// Main as link-append-fixtures.py summarizes Blender's.
const rounded = (values) => [...values].map((v) => Number(v.toFixed(4)) || 0);
const library = (id) => id.library?.filepath.split('/').pop() ?? null;
const override = (id) => (id.override_library ? (id.override_library.is_system_override ? 'SYSTEM' : 'USER') : null);
const idSummary = (id) => ({ name: id.name, library: library(id), override: override(id), users: id.users });
const sorted = (list) => list.sort((a, b) => (a.name + (a.library ?? '') < b.name + (b.library ?? '') ? -1 : 1));
const collection = (c) => ({ name: c.name, objects: [...c.objects].map((o) => o.name).sort(), children: [...c.children].map(collection) });
function summary() {
  const data = blendData(), scene = inPythonContext(main.C, () => contextStruct().scene), inScene = (o) => [...scene.objects].some((s) => s.name === o.name);
  return {
    libraries: [...data.libraries].map((l) => l.filepath.split('/').pop()).sort(),
    collections: sorted([...data.collections].map(idSummary)),
    objects: sorted([...data.objects].map((o) => ({ ...idSummary(o), type: o.type, location: rounded([...o.matrix_world].slice(12, 15)),
      instance_collection: o.instance_collection?.name ?? null, in_scene: inScene(o), selected: inScene(o) ? o.select_get() : false,
      materials: [...o.material_slots].map((s) => s.material?.name ?? null) }))),
    materials: sorted([...data.materials].map(idSummary)),
    meshes: sorted([...data.meshes].map(idSummary)),
    scene: collection(scene.collection),
  };
}
const asBlender = (got, expected, what) => assert.deepEqual(JSON.parse(JSON.stringify(got)), expected, `${what} as Blender 5.2.3 makes it`);

const LABELS = { link: 'Link...', append: 'Append...' };
for (const [kind, [op, folder, name]] of Object.entries({ link_collection: ['link', 'Collection', 'Street Lamp'], append_collection: ['append', 'Collection', 'Street Lamp'],
  link_object: ['link', 'Object', 'Bench'], append_object: ['append', 'Object', 'Bench'], link_material: ['link', 'Material', 'Cobblestone'], append_material: ['append', 'Material', 'Cobblestone'] })) {
  main.readBlend(fixture('host.blend'));
  assert.ok(await linkAppend(LABELS[op], folder, name), `${kind} pushed an undo step`);
  asBlender(summary(), reference[kind], kind);
}

// Drawn by the view (main-view.js) of a world over this Main: the linked collection's objects through its instancing
// empty only, and Object > Library Override > Make on that empty leaves the overrides as scene objects with Blender's
// names, Main as Blender makes it.
main.readBlend(fixture('host.blend'));
const scene = new Scene(new NullEngine());
const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(main) });
const world = { scene, objects: Object.assign([], { scene }), animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => scene.cameras, get: () => null, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.worlds = createWorlds(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
world.curves = createCurveObjects(world);
registerObjects(animation, world.objects);
const sync = createMainSync({ rna: createRNA({ world, selection: createSelection(scene, world.objects) }), ids: animation.ids });
const drawn = () => world.objects.filter((node) => !deleted(node) && node.isEnabled()).map((node) => node.name).sort();
await linkAppend(LABELS.link, 'Collection', 'Street Lamp');
sync.view();
assert.deepEqual(drawn(), ['Street Lamp'], 'the linked objects are drawn by the instancing empty, not as scene objects');
const instances = () => scene.meshes.filter((mesh) => mesh.name.startsWith('__instances')).reduce((n, mesh) => n + mesh.thinInstanceCount, 0);
assert.equal(instances(), 2, 'the empty draws the post and the lantern as instances');
const result = sync.run(() => main.run('object.make_override_library', {}));
assert.ok(result.status & 4, `object.make_override_library: ${result.report}`);
sync.view();
sync.flush();
assert.deepEqual(drawn(), ['Lamp Light', 'Lantern', 'Post'], 'the overrides are the scene objects');
asBlender(summary(), reference.override_collection, 'the override');

// The project keeps the library (libraries/library.blend), and its .blend, read again with the library loaded from the
// project's files, resolves the links.
const kept = unkeptLibraries(new Set());
assert.deepEqual(kept.map(([path]) => path), ['libraries/library.blend'], 'the project keeps the library Main links from');
assert.equal(unkeptLibraries(new Set(['libraries/library.blend'])).length, 0, 'once');
main.readBlend(fixture('host.blend'));
await linkAppend(LABELS.link, 'Collection', 'Street Lamp');
const saved = main.writeBlend('/project.blend');
for (const path of [...files.keys()].filter((path) => path.startsWith('/libraries/'))) files.delete(path);
await loadLibraries(['index.js', ...kept.map(([path]) => path)], async (path) => kept.find(([p]) => p === path)[1]);
main.readBlend(saved);
main.evaluate();
asBlender(summary(), reference.link_collection, 'the saved project, read again');
console.log("File > Link and Append: a collection, an object and a material, and a library override, as Blender 5.2.3 makes them");
