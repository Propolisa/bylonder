// Draw time of heavy panels and menus, drawn by the transpiled tree's classes and then by the same classes of Blender's
// scripts registered in the module's CPython (which replace the tree's), through Blender's uiLayout either way (data
// for choosing which Python draws the interface). usage: node bench/ui-python.bench.js [runs]
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { Window, RGN_TYPE_WINDOW, RGN_TYPE_UI } from '../src/windowmanager/wm-window.js';
import { menuTree, regionPanels } from '../src/editors/interface/ui-tree.js';
import { blendData, pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';
import { startPython } from '../src/python/python.js';

const runs = Number(process.argv[2] ?? 20);
const SPACE_VIEW3D = 1, SPACE_PROPERTIES = 4, SPACE_TEXT = 9;
const main = blenderMain();
setContextPointer(main.C);
const window = new Window(main);
window.size = { width: 1600, height: 900 };
const rect = { x: 0, y: 0, width: 1600, height: 900 };
main.run('mesh.primitive_cube_add', {});

const view = window.area(SPACE_VIEW3D);
view.layout(rect, { [RGN_TYPE_WINDOW]: rect, [RGN_TYPE_UI]: { x: 1300, y: 0, width: 300, height: 900 } });
const properties = window.area(SPACE_PROPERTIES);
properties.layout(rect, { [RGN_TYPE_WINDOW]: rect });
const space = pointerStruct(structFind('Area'), 0, properties.pointer).spaces.active;
const propertiesPanels = () => properties.inContext(RGN_TYPE_WINDOW, (C) => regionPanels(C));
// A draw finds the tabs the context has (buttons_context_compute), which the tab's value is checked against.
const tab = (context) => { if (space.context !== context) propertiesPanels(), space.context = context; return propertiesPanels(); };
const DRAWS = {
  'Properties > Object': () => tab('OBJECT'),
  'Properties > Render': () => tab('RENDER'),
  'Sidebar > Item and View': () => view.inContext(RGN_TYPE_UI, (C) => regionPanels(C)),
  'VIEW3D_MT_add': () => view.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, 'VIEW3D_MT_add')),
  'VIEW3D_MT_object': () => view.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, 'VIEW3D_MT_object')),
};
const median = (fn) => {
  fn();
  const times = Array.from({ length: runs }, () => { const t = performance.now(); fn(); return performance.now() - t; }).sort((a, b) => a - b);
  return times[times.length >> 1];
};
const measure = () => Object.fromEntries(Object.entries(DRAWS).map(([name, fn]) => [name, median(fn)]));

const tree = measure();
await startPython();
// The same classes from Blender's scripts in CPython, registered as Blender's startup registers them.
const text = blendData().texts.new('register.py');
text.from_string(`import bpy, importlib
for name in ("properties_object", "properties_render", "space_view3d", "space_view3d_sidebar"):
    module = importlib.import_module("bl_ui." + name)
    for cls in getattr(module, "classes", ()):
        bpy.utils.register_class(cls)
`);
const editor = window.area(SPACE_TEXT);
editor.layout(rect, { [RGN_TYPE_WINDOW]: rect });
pointerStruct(structFind('Area'), 0, editor.pointer).spaces.active.text = text;
editor.inContext(RGN_TYPE_WINDOW, () => main.invoke('text.run_script', {}, {}));
const cpython = measure();

console.log(`median of ${runs} draws, ms (transpiled tree | CPython)`);
for (const name of Object.keys(DRAWS)) console.log(`${name.padEnd(26)} ${tree[name].toFixed(2).padStart(8)} | ${cpython[name].toFixed(2).padStart(8)}`);
