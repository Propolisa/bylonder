// Blender's Python (bpy_interface.cc): Blender's scripts, transpiled whole (src/bl_py, tools/blender-ui/tree.py), loaded
// and started as Blender starts them, which registers their classes. Bylonder draws and runs those classes by name.
import { loadRNAUI } from '../makesrna/rna.js';
import { invokeOperator, runOperator, pollOperator, hasOperator, runsOperator, ownsOperator, registerFallback, onRegister, extendMenus } from '../windowmanager/wm-operators.js';
import { hasOperator as blenderHasOperator, newOperator, blenderModule } from '../bmesh/bmesh-wasm.js';
import { set, bool, __class__, __get__ } from '../bl_py/org.transcrypt.__runtime__.js';
import { registerClass, inPythonContext, contextPointer, inClassCall } from './bpy_rna.js';

const { exports: x, withString, cString } = blenderModule;


// Blender's scripts read RNA's enums as they load. Vite serves JSON as a module, without Node's import attribute.
await loadRNAUI(import.meta.env ? () => import('../makesrna/rna-ui.json') : undefined);
await import('../bl_py/__main__.js');
const _bpy = globalThis.__py_modules._bpy;

// bpy.ops (the boundary's _bpy.ops, bpy_operator.cc): an operator Bylonder runs its own way, or any its registry has
// outside Blender's callbacks (a script's, with the scene made current around it), runs in the registry; the others go
// through Blender's WM_operator_call_py in the context Python runs in, so an invoke gets the window's current event and
// a modal operator keeps running in the window. Each returns Blender's result set.
const CALL_CONTEXTS = ['INVOKE_DEFAULT', 'INVOKE_REGION_WIN', 'INVOKE_REGION_CHANNELS', 'INVOKE_REGION_PREVIEW', 'INVOKE_AREA', 'INVOKE_SCREEN',
  'EXEC_DEFAULT', 'EXEC_REGION_WIN', 'EXEC_REGION_CHANNELS', 'EXEC_REGION_PREVIEW', 'EXEC_AREA', 'EXEC_SCREEN'];
const STATUS = [[1, 'RUNNING_MODAL'], [2, 'CANCELLED'], [4, 'FINISHED'], [8, 'PASS_THROUGH'], [16, 'INTERFACE']];
const inRegistry = (idname) => ownsOperator(idname) || (!inClassCall() && runsOperator(idname));
globalThis.__bylonder_operators__ = {
  poll(idname, props, context = 'EXEC_DEFAULT') {
    if (inRegistry(idname)) return pollOperator(idname, props);
    return !!withString(idname, (p) => x.bpy_operator_poll(contextPointer(), p, CALL_CONTEXTS.indexOf(context)));
  },
  call(idname, props, context) {
    if (inRegistry(idname)) {
      if (!pollOperator(idname, props)) throw Error(`${idname}.poll() failed, context is incorrect`);
      const result = context.startsWith('INVOKE') ? invokeOperator(idname, props, null) : runOperator(idname, props);
      return set([typeof result === 'string' ? result : 'FINISHED']);
    }
    const op = newOperator(idname, props);
    let status;
    try {
      status = x.bpy_operator_call(contextPointer(), op, CALL_CONTEXTS.indexOf(context));
    } finally {
      x.operator_free(op);
    }
    if (status < 0) throw Error(`Operator bpy.ops.${idname}.poll() failed, context is incorrect`);
    const error = cString(x.bpy_operator_call_error());
    if (error) throw Error(error);
    return set(STATUS.filter(([bit]) => status & bit).map(([, name]) => name));
  },
};

// Registered classes by Blender's idname (VIEW3D_MT_object, PROPERTIES_PT_context_object, OBJECT_OT_...).
export const registered = _bpy.registered;

// Blender's panels, menus, headers, lists and operators become Blender's types in the module, in the order the scripts
// register them, as register_class makes them (bpy_rna.js), so Blender's regions lay them out and its window manager
// runs them.
const REGISTERED_TYPES = /_(PT|MT|HT|UL)_|\./;
for (const [idname, cls] of Object.entries(registered)) {
  if (!REGISTERED_TYPES.test(idname)) continue;
  try {
    registerClass(cls);
  } catch (error) {
    console.error(`Python: register_class(${idname}):`, error.__args__?.[0] ?? error);
  }
}
// Bylonder's operators Blender has no type for become Blender's operator types, as an add-on's Python operators do:
// Blender's menus and buttons show them, polled and run by Bylonder.
const ownTypes = new Set();
onRegister((idname) => {
  if (ownTypes.has(idname) || blenderHasOperator(idname) || registered[idname] || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(idname)) return;
  ownTypes.add(idname);
  const [prefix, name] = idname.split('.');
  try {
    registerClass(__class__(`${prefix.toUpperCase()}_OT_${name}`, [globalThis.__py_modules['_bpy.types'].Operator], {
      bl_idname: idname,
      bl_label: idname,
      poll: () => pollOperator(idname, {}),
      execute: () => set([runOperator(idname, {}) ?? 'FINISHED']),
    }));
  } catch (error) {
    console.error(`register_class(${idname}):`, error.__args__?.[0] ?? error);
  }
});
// Menu.append and Menu.prepend of Bylonder's draw functions (appendMenu), on Blender's menu types. They make the class's
// draw a function (_GenericUI._dyn_ui_initialize), which Python binds to the instance and Transcrypt does not: it is
// given through __get__, as the class's own methods are.
extendMenus((idname, side, draw) => {
  const cls = registered[idname];
  if (!cls) return;
  cls[side](draw);
  const own = Object.getOwnPropertyDescriptor(cls, 'draw');
  if (typeof own?.value === 'function') Object.defineProperty(cls, 'draw', { get() { return __get__(this, own.value); }, configurable: true });
});

// A menu type of Bylonder's, as an add-on registers a Menu: `draw(layout, context)`.
export function registerMenu(bl_idname, bl_label, draw) {
  if (registered[bl_idname]) return;
  registered[bl_idname] = __class__(bl_idname, [globalThis.__py_modules['_bpy.types'].Menu], {
    bl_idname, bl_label,
    get draw() { return __get__(this, (self, context) => draw(self.layout, context)); },
  });
  registerClass(registered[bl_idname]);
}

const ofKind = (kind) => Object.fromEntries(Object.entries(registered).filter(([idname]) => idname.includes(kind)));
export const menus = ofKind('_MT_');
export const panels = ofKind('_PT_');
export const headers = ofKind('_HT_');

// A module of the tree by its Python name (bl_ui.space_toolsystem_common).
export const module = (name) => globalThis.__py_modules[name];

// Blender's Python operators are Blender's operator types (rna-operator.cc). Those Bylonder does not run its own way are
// run by Blender in the scene's window with `run(idname, props, event)` (runBlenderOperator, the scene made current around
// them), polled by their class in its context once `beforePoll()` made Main current.
export function registerPythonOperators(run, beforePoll) {
  for (const [idname, cls] of Object.entries(registered)) {
    if (!idname.includes('.') || hasOperator(idname)) continue;
    registerFallback(idname, {
      blender: true,
      poll: () => {
        beforePoll();
        try {
          return inPythonContext(contextPointer(), () => !cls.poll || !!bool(cls.poll(_bpy.context)));
        } catch (error) {
          // As bpy_class_call: an exception in poll is printed and the operator is unavailable.
          console.error(`Python: ${idname}.poll`, error);
          return false;
        }
      },
      run: (props, event) => run(idname, props, event),
    });
  }
}

// bpy.context (and bpy.data) for what is drawn or run next, as Blender sets the window manager's context.
export const setContext = (context) => _bpy._context_set(context, context.blend_data ?? null);
