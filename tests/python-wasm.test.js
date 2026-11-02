// CPython in Blender's module (tools/blender-port/wasm/python.cc, src/python/python.js): Blender's own bpy over Main.
// A script run by the Text Editor's Run Script, numpy over foreach_get and foreach_set, a line in the Python Console,
// and classes a script registers (an operator, a panel, a function appended to a menu of the transpiled tree, a keymap
// item of the add-on key configuration) working in Blender's window.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { blenderMain, operatorNames } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { loadKeyconfig, RGN_TYPE_WINDOW, RGN_TYPE_UI } from '../src/windowmanager/wm-window.js';
import { blenderWindow } from '../src/windowmanager/wm-areas.js';
import { setFileChooser } from '../src/windowmanager/wm-fileselect.js';
import { menuTree, regionPanels } from '../src/editors/interface/ui-tree.js';
import { blendData, pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';
import { startPython, pythonRunning } from '../src/python/python.js';
import { files } from '../src/port/wasm.js';

const SPACE_VIEW3D = 1, SPACE_TEXT = 9, SPACE_CONSOLE = 18;
const main = blenderMain();
setContextPointer(main.C);
const window = blenderWindow();
window.size = { width: 1200, height: 800 };
loadKeyconfig(main.C);
main.undoInit();
window.allow(operatorNames().filter((idname) => /^(text|console)\./.test(idname)));
const rect = { x: 0, y: 0, width: 1200, height: 800 };
const press = (code, key, held = []) => {
  const modifiers = { shift: ['ShiftLeft', 'Shift'], ctrl: ['ControlLeft', 'Control'], alt: ['AltLeft', 'Alt'] };
  for (const m of held) window.event('keydown', [0], { code: modifiers[m][0], key: modifiers[m][1] });
  window.event('keydown', [0], { code, key });
  window.event('keyup', [0], { code, key });
  for (const m of held.toReversed()) window.event('keyup', [0], { code: modifiers[m][0], key: modifiers[m][1] });
};

assert.equal(pythonRunning(), false, 'Python does not start with the module');
let started = performance.now();
await startPython();
started = performance.now() - started;
assert.ok(pythonRunning());

// Run Script: a Text in the Text Editor, Blender's text.run_script (BPY_run_text) in its area, as the page runs it.
const textArea = window.area(SPACE_TEXT);
textArea.layout(rect, { [RGN_TYPE_WINDOW]: rect });
const run = (source) => {
  const text = blendData().texts.new('script.py');
  text.from_string(source);
  pointerStruct(structFind('Area'), 0, textArea.pointer).spaces.active.text = text;
  textArea.inContext(RGN_TYPE_WINDOW, () => main.invoke('text.run_script', {}, {}));
};
const output = () => blendData().texts.get('out')?.as_string();
run(`import bpy, sys, numpy as np
bpy.ops.mesh.primitive_cube_add(size=2)
mesh = bpy.context.object.data
co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
mesh.vertices.foreach_get("co", co)
co.shape = (-1, 3)
co[:, 2] += 1.0
mesh.vertices.foreach_set("co", co.ravel())
view = memoryview(mesh.vertices[0].co)
bpy.data.texts.new("out").write(f"{sys.version.split()[0]} {np.__version__} {len(co)} {mesh.vertices[0].co.z:.1f} {view.format}")
`);
assert.equal(output(), '3.13.13 2.3.4 8 0.0 f', 'bpy, numpy, foreach_get and foreach_set, and mathutils buffers in the embedded CPython');
// A memoryview of a mathutils value holds a reference of its own: releasing it leaves the value's count as it was.
blendData().texts.remove(blendData().texts.get('out'));
run(`import bpy, sys, mathutils
counts = []
for value in (mathutils.Vector((1, 2, 3)), mathutils.Matrix(), mathutils.Euler(), mathutils.Quaternion(), mathutils.Color()):
    before = sys.getrefcount(value)
    view = memoryview(value)
    view.release()
    counts.append(sys.getrefcount(value) - before)
bpy.data.texts.new("out").write(str(counts))
`);
assert.equal(output(), '[0, 0, 0, 0, 0]', "a mathutils value's memoryview keeps the value's reference count");

// A driver whose expression needs Python (not one expr_pylike_eval.cc evaluates), where scripts may run automatically.
run(`import bpy
bpy.context.preferences.filepaths.use_scripts_auto_execute = True
ob = bpy.context.object
driver = ob.driver_add("location", 0).driver
driver.expression = "len(bpy.data.objects) * 10"
bpy.context.view_layer.update()
bpy.data.texts["out"].from_string(f"{ob.location.x:.1f}")
`);
assert.equal(output(), '10.0', "a Python driver evaluates in the module's CPython");

// A script's classes: an operator, a sidebar panel, a function appended to the tree's Add menu, an add-on keymap item.
run(`import bpy
class TEST_OT_hello(bpy.types.Operator):
    bl_idname = "test.hello"
    bl_label = "Hello"
    def execute(self, context):
        context.scene["hello"] = context.scene.get("hello", 0) + 1
        return {'FINISHED'}
class TEST_PT_panel(bpy.types.Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Test"
    bl_label = "Test Panel"
    def draw(self, context):
        self.layout.operator("test.hello")
def menu(self, context):
    self.layout.operator("test.hello", text="Hello from CPython")
bpy.utils.register_class(TEST_OT_hello)
bpy.utils.register_class(TEST_PT_panel)
bpy.types.VIEW3D_MT_add.append(menu)
km = bpy.context.window_manager.keyconfigs.addon.keymaps.new("3D View", space_type='VIEW_3D')
km.keymap_items.new("test.hello", 'H', 'PRESS', ctrl=True, shift=True)
bpy.context.window_manager.keyconfigs.update()
`);
const view = window.area(SPACE_VIEW3D);
view.layout(rect, { [RGN_TYPE_WINDOW]: rect, [RGN_TYPE_UI]: { x: 900, y: 0, width: 300, height: 800 } });
const scene = () => blendData().scenes[0];
const hello = () => scene().get('hello') ?? 0;
const { categories } = view.inContext(RGN_TYPE_UI, (C) => regionPanels(C));
assert.ok(categories.includes('Test'), "a panel CPython registered is one of the sidebar's tabs");
assert.ok(JSON.stringify(view.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, 'VIEW3D_MT_add'))).includes('Hello from CPython'),
  "a function CPython appended to the transpiled tree's Add menu draws in it");
window.event('pointermove', [400, 400]);
press('KeyH', 'h', ['ctrl', 'shift']);
assert.equal(hello(), 1, "the add-on keymap item runs CPython's operator through Blender's window manager");
view.inContext(RGN_TYPE_WINDOW, () => main.invoke('test.hello', {}, {}));
assert.equal(hello(), 2, 'the page runs it by idname');

// What an operator the window allowed runs is its own, as in Blender: a CPython modal operator started by its key runs
// bpy.ops in a modal step (mesh.primitive_cube_add, which the window alone would leave to the page). After every
// return the window's gating is back: the page still gets the keys of operators it runs itself (G).
run(`import bpy
class TEST_OT_modal_add(bpy.types.Operator):
    bl_idname = "test.modal_add"
    bl_label = "Modal Add"
    def invoke(self, context, event):
        context.window_manager.modal_handler_add(self)
        return {'RUNNING_MODAL'}
    def modal(self, context, event):
        if event.type != 'MOUSEMOVE':
            return {'RUNNING_MODAL'}
        bpy.ops.mesh.primitive_cube_add()
        return {'FINISHED'}
bpy.utils.register_class(TEST_OT_modal_add)
km = bpy.context.window_manager.keyconfigs.addon.keymaps.new("3D View", space_type='VIEW_3D')
km.keymap_items.new("test.modal_add", 'J', 'PRESS', ctrl=True, shift=True)
bpy.context.window_manager.keyconfigs.update()
`);
const objectCount = () => blendData().objects.length;
const beforeModal = objectCount();
press('KeyJ', 'j', ['ctrl', 'shift']);
window.event('pointermove', [410, 410]);
assert.equal(objectCount(), beforeModal + 1, "an allowed modal operator's step runs the operators it calls");
const unhandled = window.event('keydown', [0], { code: 'KeyG', key: 'g' }).unhandled;
window.event('keyup', [0], { code: 'KeyG', key: 'g' });
assert.ok(unhandled.length > 0, 'and afterwards an operator the window does not run is left to the page again');

// Install from Disk (Preferences > Add-ons, extensions.package_install_files of Blender's bl_pkg): Blender's invoke opens
// the file browser, here the page's dialog (wm-fileselect.js) giving the file; the operator installs it into the user's
// directory, which the browser keeps, and enables it. A .py is a legacy add-on (the user's scripts/addons), a .zip with
// a blender_manifest.toml an extension (the User Default repository).
// Its modal operator steps on a window timer until the file is in place.
const installFromDisk = async (name, bytes, installed) => {
  setFileChooser({ open: async ({ filter_glob }) => (assert.match(filter_glob, /\*\.py/), { files: [[name, bytes]] }), options: async () => true });
  view.inContext(RGN_TYPE_WINDOW, () => main.invoke('extensions.package_install_files', {}, {}));
  for (let i = 0; i < 200 && !files.has(installed); i++) await new Promise((resolve) => setTimeout(resolve, 20)), window.tick();
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 20)), window.tick();
  assert.ok(files.has(installed), `${name} is installed as ${installed}`);
};
await installFromDisk('scatter_cubes.py', readFileSync(new URL('../examples/python/scatter_cubes.py', import.meta.url)), '/user/5.2/scripts/addons/scatter_cubes.py');
run(`import bpy, addon_utils
listed = [m.bl_info["name"] for m in addon_utils.modules() if m.__name__ == "scatter_cubes"]
bpy.data.texts["out"].from_string(f"{listed} {'scatter_cubes' in bpy.context.preferences.addons}")
`);
assert.equal(output(), "['Scatter Cubes'] True", 'the add-on is listed and enabled');
const manifest = 'schema_version = "1.0.0"\nid = "hello_extension"\nversion = "1.0.0"\nname = "Hello Extension"\ntagline = "Says hello"\n'
  + 'maintainer = "Bylonder"\ntype = "add-on"\nblender_version_min = "4.2.0"\nlicense = ["SPDX:GPL-3.0-or-later"]\n';
const extension = `import bpy
class HELLO_OT_extension(bpy.types.Operator):
    bl_idname = "hello.extension"
    bl_label = "Hello Extension"
    def execute(self, context):
        context.scene["extension"] = 1
        return {'FINISHED'}
def register():
    bpy.utils.register_class(HELLO_OT_extension)
def unregister():
    bpy.utils.unregister_class(HELLO_OT_extension)
`;
await installFromDisk('hello_extension.zip', zipSync({ 'hello_extension/blender_manifest.toml': strToU8(manifest), 'hello_extension/__init__.py': strToU8(extension) }),
  '/user/5.2/extensions/user_default/hello_extension/__init__.py');
view.inContext(RGN_TYPE_WINDOW, () => main.invoke('hello.extension', {}, {}));
assert.equal(scene().get('extension'), 1, 'the extension is enabled and its operator runs');
const objects = blendData().objects.length;
view.inContext(RGN_TYPE_WINDOW, () => main.invoke('object.scatter_cubes', { count: 3 }, {}));
assert.equal(blendData().objects.length, objects + 3, "the add-on's operator adds its cubes");
assert.ok(JSON.stringify(view.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, 'VIEW3D_MT_object'))).includes('Scatter Cubes'), 'and Object lists it');

// The Python Console: a line executed by console.execute (bl_operators/console.py, _console_python).
const consoleArea = window.area(SPACE_CONSOLE);
consoleArea.layout(rect, { [RGN_TYPE_WINDOW]: rect });
consoleArea.draw(RGN_TYPE_WINDOW);
const scrollback = () => [...pointerStruct(structFind('Area'), 0, consoleArea.pointer).spaces.active.scrollback].map((line) => line.body);
assert.ok(scrollback().some((line) => line.startsWith('PYTHON INTERACTIVE CONSOLE 3.13.13')), 'its first draw prints the banner (console.banner)');
window.event('pointermove', [600, 400]);
for (const c of '6*7') window.event('keydown', [0], { code: c === '*' ? 'Digit8' : `Digit${c}`, key: c, text: c });
const { finished } = window.event('keydown', [0], { code: 'Enter', key: 'Enter' });
window.event('keyup', [0], { code: 'Enter', key: 'Enter' });
assert.ok(finished.some(({ idname, undo }) => idname === 'CONSOLE_OT_execute' && undo),
  `the page learns that console.execute finished, though it is not registered for redo (${JSON.stringify(finished)})`);
const lines = scrollback();
assert.ok(lines.includes('42'), `the console prints 6*7 (${lines.slice(-3).join(' | ')})`);
// Every letter is the console's text, though the User Interface keymap has E and I (eyedroppers, Insert Keyframe on a
// button), whose operators the page runs: they pass the key on, and an operator a typed line calls runs.
const keyCode = (c) => (/[a-z]/.test(c) ? `Key${c.toUpperCase()}` : { '.': 'Period', '(': 'Digit9', ')': 'Digit0', '_': 'Minus' }[c]);
const typed = 'bpy.ops.mesh.primitive_cube_add()', objectsBefore = blendData().objects.length;
for (const c of typed) {
  window.event('keydown', [0], { code: keyCode(c), key: c, text: c });
  window.event('keyup', [0], { code: keyCode(c), key: c });
}
press('Enter', 'Enter');
assert.ok(scrollback().some((line) => line.endsWith(typed)), `the console has the typed line (${scrollback().slice(-2).join(' | ')})`);
assert.equal(blendData().objects.length, objectsBefore + 1, 'and its operator added the cube');

console.log(`python: CPython 3.13 and numpy in the module, started in ${Math.round(started)} ms; Run Script, the console, registered classes and Install from Disk of an add-on and an extension work`);
