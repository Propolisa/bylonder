// Blender's Python (bpy_interface.cc): Blender's scripts, transpiled whole (src/bl_py, tools/blender-ui/tree.py), loaded
// and started as Blender starts them, which registers their classes. Bylonder draws and runs those classes by name.
import { loadRNAUI } from '../makesrna/rna.js';
import { invokeOperator, runOperator, pollOperator, hasOperator, registerOperator, onRegister, extendMenus } from '../windowmanager/wm-operators.js';
import { hasOperator as blenderHasOperator } from '../bmesh/bmesh-wasm.js';
import { report } from '../windowmanager/wm-reports.js';
import { set, __class__, __get__ } from '../bl_py/org.transcrypt.__runtime__.js';
import { registerClass } from './bpy_rna.js';


// Blender's scripts read RNA's enums as they load. Vite serves JSON as a module, without Node's import attribute.
await loadRNAUI(import.meta.env ? () => import('../makesrna/rna-ui.json') : undefined);
await import('../bl_py/__main__.js');
const _bpy = globalThis.__py_modules._bpy;

// bpy.ops (the boundary's _bpy.ops) runs Blender's operators by idname in Bylonder's registry: invoked or executed as
// the execution context says, returning Blender's result set.
globalThis.__bylonder_operators__ = {
  poll: (...args) => pollOperator(...args),
  call(idname, props, context) {
    if (!pollOperator(idname, props)) throw Error(`${idname}.poll() failed, context is incorrect`);
    const result = context.startsWith('INVOKE') ? invokeOperator(idname, props, null) : runOperator(idname, props);
    return set([typeof result === 'string' ? result : 'FINISHED']);
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

const ofKind = (kind) => Object.fromEntries(Object.entries(registered).filter(([idname]) => idname.includes(kind)));
export const menus = ofKind('_MT_');
export const panels = ofKind('_PT_');
export const headers = ofKind('_HT_');

// A module of the tree by its Python name (bl_ui.space_toolsystem_common).
export const module = (name) => globalThis.__py_modules[name];

// Blender's Python operators (bpy_operator_wrap.cc) Bylonder does not run its own way: an instance with its properties'
// defaults and the values given, under Python's names and Transcrypt's (py_name), polled and executed (or invoked
// from an event) in bpy.context. Bylonder's own registration of an idname, before or after, replaces this.
const pythonNames = (key) => (key === 'type' ? ['type', 'py_metatype'] : [key, `py_${key}`]);
function operatorInstance(cls, props) {
  const operator = cls();
  for (const [name, property] of Object.entries(cls.__annotations__ ?? {})) for (const key of pythonNames(name)) operator[key] = property.keywords?.default ?? null;
  for (const [name, value] of Object.entries(props)) for (const key of pythonNames(name)) operator[key] = value;
  operator.properties = operator;
  operator.report = (types, message) => report([...types][0] ?? 'INFO', message);
  return operator;
}
for (const [idname, cls] of Object.entries(registered)) {
  if (!idname.includes('.') || hasOperator(idname)) continue;
  registerOperator(idname, {
    poll: () => {
      try {
        return !cls.poll || !!cls.poll(_bpy.context);
      } catch (error) {
        // As bpy_class_call: an exception in poll is printed and the operator is unavailable.
        console.error(`Python: ${idname}.poll`, error);
        return false;
      }
    },
    run(props, event) {
      const operator = operatorInstance(cls, props);
      const result = event && operator.invoke ? operator.invoke(_bpy.context, event) : operator.execute?.(_bpy.context);
      return [...(result ?? ['FINISHED'])][0];
    },
  });
}

// bpy.context (and bpy.data) for what is drawn or run next, as Blender sets the window manager's context.
export const setContext = (context) => _bpy._context_set(context, context.blend_data ?? null);
