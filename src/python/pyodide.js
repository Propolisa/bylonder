// CPython (Pyodide, CPython in WebAssembly) for Run Script and the Python Console, loaded from its CDN at a pinned
// version on first use, never at startup. Its bpy, mathutils, bpy_extras (any module of Blender's Python tree that
// CPython lacks) are the tree's own modules seen through Pyodide's FFI by bridge.py, through the helpers below: the
// same bpy.context, bpy.data, bpy.ops and bpy.types objects the interface uses, with Python's meaning where the
// tree's Transcrypt conventions differ (renamed names, keyword arguments, None as null). See docs/blender-boundary.md.
import * as runtime from '../bl_py/org.transcrypt.__runtime__.js';
import { INFO, baseOf } from '../makesrna/rna.js';
import { useContext } from '../editors/interface/layout.js';
import { inArea } from '../windowmanager/wm-operators.js';

export const PYODIDE_VERSION = '0.29.5';
const PYODIDE_URL = `https://cdn.jsdelivr.net/npm/pyodide@${PYODIDE_VERSION}/`;

// Names Transcrypt renames because they collide with JS or its runtime (type is py_metatype, name py_name, ...).
const ALIASES = Object.fromEntries(['name', 'get', 'keys', 'items', 'values', 'new', 'split', 'replace', 'pop', 'sort', 'iter', 'next', 'update', 'clear',
  'del', 'default', 'is', 'setdefault', 'popitem', 'reversed', 'arguments', 'case', 'switch', 'selector', 'TypeError'].map((n) => [n, 'py_' + n]).concat([['type', 'py_metatype']]));
const unalias = (key) => (key === 'py_metatype' ? 'type' : key.startsWith('py_') ? key.slice(3) : key);
const modules = () => globalThis.__py_modules ?? {};
// Pyodide takes an object with a `then` for a promise, and a module's __getattr__ (PEP 562) would make one: such
// objects cross as a view without `then`, and come back as themselves. JS's null is Python's None (undefined).
const views = new WeakMap(), targets = new WeakMap();
function out(value) {
  if (value === null) return undefined;
  if (Object(value) !== value || !('__getattr__' in value)) return value;
  if (!views.has(value)) {
    const view = new Proxy(value, { get: (target, key) => (key === 'then' ? undefined : target[key]) });
    views.set(value, view);
    targets.set(view, value);
  }
  return views.get(value);
}
const none = (value) => (value === undefined ? null : targets.get(value) ?? value);
const error = (kind, message) => new Error(`${kind}: ${message}`);
const ids = new WeakMap();
let nextId = 1;

// The repr of a struct as Blender's (pyrna_struct_repr): an ID by its path in bpy.data, other structs by type.
const ID_COLLECTIONS = { Object: 'objects', Mesh: 'meshes', Scene: 'scenes', Text: 'texts', Material: 'materials', Light: 'lights', Camera: 'cameras',
  World: 'worlds', Collection: 'collections', Curve: 'curves', Image: 'images', Action: 'actions', NodeTree: 'node_groups', WorkSpace: 'workspaces' };
const idCollection = (struct) => { for (let s = struct; s; s = baseOf(s)) if (ID_COLLECTIONS[s]) return ID_COLLECTIONS[s]; return null; };
function structRepr(obj, info) {
  const collection = idCollection(info.struct), name = obj.name;
  if (collection && typeof name === 'string') return `bpy.data.${collection}['${name}']`;
  return `<bpy_struct, ${info.struct}${typeof name === 'string' ? `("${name}")` : ''} at 0x${identity(obj).toString(16).padStart(12, '0')}>`;
}
function identity(value) {
  if (!ids.has(value)) ids.set(value, nextId++);
  return ids.get(value);
}

// The JS side of bridge.py (_bylonder_js), exported for tests.
export const api = {
  module: (name) => modules()[name],
  hasModule: (name) => name in modules(),
  isPackage: (name) => Object.keys(modules()).some((other) => other.startsWith(name + '.')),
  isCollection: (value) => Array.isArray(value) && typeof value.find === 'function' && typeof value.get === 'function',
  isModule: (value) => value?.[Symbol.toStringTag] === 'Module',
  moduleName: (value) => Object.entries(modules()).find(([, module]) => module === value)?.[0] ?? '',
  exported: (module) => (module.__all__ ? [...module.__all__] : Object.keys(module).filter((key) => !key.startsWith('_'))),
  // Without reading __call__ from a module, whose __getattr__ (PEP 562) would make it.
  isCallable: (value) => typeof value === 'function' || ('__call__' in Object(value) && typeof value.__call__ === 'function'),
  getattr(obj, name) {
    const target = Object(obj), alias = ALIASES[name];
    if (alias && alias in target) return out(obj[alias]);
    if (name in target) return out(obj[name]);
    const value = obj[name];
    if (value !== undefined) return out(value);
    if (typeof target.__getattr__ === 'function') return out(runtime.__call__(target.__getattr__, obj, name));
    throw error('AttributeError', `'${obj?.[INFO]?.struct ?? obj?.constructor?.name ?? typeof obj}' object has no attribute '${name}'`);
  },
  setattr(obj, name, value) {
    const alias = ALIASES[name];
    obj[alias && alias in Object(obj) ? alias : name] = none(value);
  },
  call(fn, self, args, kwargs) {
    const keywords = Object.keys(kwargs);
    const list = [...args].map(none);
    if (keywords.length) list.push(runtime.__kwargtrans__(Object.fromEntries(keywords.map((key) => [ALIASES[key] ?? key, none(kwargs[key])]))));
    return out(runtime.__call__(fn, none(self), ...list));
  },
  getitem(obj, key) {
    if (typeof key === 'number' && key < 0 && typeof obj.length === 'number') key += obj.length;
    if (typeof obj.__getitem__ === 'function') return out(obj.__getitem__(key));
    if (typeof key === 'string' && Array.isArray(obj) && typeof obj.get === 'function') {
      const item = obj.get(key);
      if (item == null) throw error('KeyError', `bpy_prop_collection[key]: key "${key}" not found`);
      return item;
    }
    if (Array.isArray(obj) && typeof key === 'number' && !(key in obj)) throw error('IndexError', 'index out of range');
    return out(obj[key]);
  },
  setitem(obj, key, value) {
    if (typeof key === 'number' && key < 0 && typeof obj.length === 'number') key += obj.length;
    if (typeof obj.__setitem__ === 'function') obj.__setitem__(key, none(value));
    else obj[key] = none(value);
  },
  len: (obj) => runtime.len(obj),
  iterate: (obj) => (Array.isArray(obj) ? [...obj] : runtime.list(obj)),
  contains: (obj, value) => (typeof value === 'string' && Array.isArray(obj) && typeof obj.get === 'function' ? obj.get(value) != null : runtime.__in__(value, obj)),
  truth: (obj) => !!runtime.bool(obj),
  repr: (obj) => (obj?.[INFO] ? structRepr(obj, obj[INFO]) : typeof obj?.idname_py === 'function' ? `bpy.ops.${obj.idname_py()}()` : runtime.repr(obj)),
  str: (obj) => (obj?.[INFO] ? structRepr(obj, obj[INFO]).replace(/^bpy\.data\.\w+\['(.*)'\]$/, `<bpy_struct, ${obj[INFO].struct}("$1")>`) : runtime.str(obj)),
  dir(obj) {
    if (typeof obj?.__dir__ === 'function') return [...obj.__dir__()];
    const names = new Set(), info = obj?.[INFO];
    if (info) {
      info.bound.forEach((name) => names.add(name));
      for (const p of globalThis.__py_modules?.['_bpy.types']?.[info.struct]?.bl_rna?.properties ?? []) names.add(p.identifier);
      ['bl_rna', 'rna_type'].forEach((name) => names.add(name));
    } else {
      for (let o = Object(obj); o && o !== Object.prototype && o !== Function.prototype && o !== Array.prototype; o = Object.getPrototypeOf(o)) {
        Object.getOwnPropertyNames(o).forEach((key) => names.add(unalias(key)));
      }
    }
    return [...names].filter((name) => !name.startsWith('__') && name !== 'constructor').sort();
  },
  equals: (a, b) => a === b || !!runtime.__eq__(a, b),
  identity,
  binary: (op, a, b) => out(runtime[op](a, b)),
  unary: (op, a) => out(runtime[op](a)),
  // foreach_get and foreach_set (bpy_prop_collection): one property of every item, flattened, as one typed array each
  // way, through the items' RNA (a collection may give its own __foreach_get__ and __foreach_set__ for its data).
  foreachGet(collection, attr) {
    const own = collection.__foreach_get__?.(attr);
    if (own) return own;
    const values = [];
    for (const item of collection) { const value = item[attr]; if (value && typeof value === 'object') values.push(...value); else values.push(Number(value)); }
    return Float64Array.from(values);
  },
  foreachSet(collection, attr, values) {
    if (collection.__foreach_set__?.(attr, values)) return;
    const items = [...collection], size = items.length ? values.length / items.length : 0;
    if (!Number.isInteger(size)) throw error('TypeError', `foreach_set(attr, seq): seq length ${values.length} does not fit ${items.length} items`);
    items.forEach((item, i) => {
      const current = item[attr];
      item[attr] = current && typeof current === 'object' ? Array.from(values.subarray(i * size, (i + 1) * size))
        : typeof current === 'boolean' ? !!values[i] : values[i];
    });
  },
  pyDict: (entries) => Object.fromEntries(entries),
  pySet: (items) => runtime.set(items),
  // A Python callable for JS: called with JS's arguments, keyword arguments (Transcrypt's last __kwargtrans__) apart.
  pyFunction: (callable) => (...args) => {
    const last = args.at(-1), kwargs = last && Object.hasOwn(Object(last), '__kwargtrans__') ? args.pop() : {};
    return callable(args, Object.entries(kwargs).filter(([key]) => key !== '__kwargtrans__').map(([key, value]) => [unalias(key), value]));
  },
};

// The tree's exceptions are Transcrypt's objects, not JS errors: Python sees them as errors named by their class.
const pythonError = (error) => (error instanceof Error ? error
  : new Error(`${error?.__class__?.__name__ ?? 'Error'}: ${error?.__args__?.[0] ?? error?.message ?? String(error)}`));
for (const [name, fn] of Object.entries(api)) {
  api[name] = (...args) => { try { return fn(...args.map((arg) => targets.get(arg) ?? arg)); } catch (error) { throw pythonError(error); } };
}

let loading = null, loaded = null;
async function load() {
  const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE_URL + 'pyodide.mjs');
  const py = await loadPyodide({ indexURL: PYODIDE_URL });
  // Script output goes where Blender's goes, the system console (the browser's, which the workspace's Console shows).
  py.setStdout({ batched: (line) => console.log(line) });
  py.setStderr({ batched: (line) => console.warn(line) });
  py.registerJsModule('_bylonder_js', api);
  // Blender's own console scripts (tools/blender-ui/python_sources.py) where Blender has them.
  const scripts = import.meta.glob('./scripts/**/*.py', { query: '?raw', import: 'default' });
  for (const [path, source] of Object.entries(scripts)) {
    const file = '/blender/scripts/modules/' + path.slice('./scripts/'.length);
    py.FS.mkdirTree(file.slice(0, file.lastIndexOf('/')));
    py.FS.writeFile(file, await source());
  }
  py.runPython("import sys; sys.path.insert(0, '/blender/scripts/modules')");
  const { default: bridge } = await import('./bridge.py?raw');
  py.FS.writeFile('/blender/bridge.py', bridge);
  py.runPython("import sys; sys.path.insert(0, '/blender'); import bridge");
  loaded = py.pyimport('bridge');
  return loaded;
}
// Starts loading CPython (opening a Python Console, running a script); resolves to the bridge module.
export const loadPython = () => (loading ??= load().catch((reason) => { loading = null; throw reason; }));
export const pythonLoaded = () => !!loaded;

// A script run in an editor's context (its area for operators, its bpy.context): { error, line } on failure.
export async function runText(name, source, editor) {
  const bridge = await loadPython();
  const result = inArea(editor.area, () => { useContext(editor.context()); return bridge.run_text(name, source); });
  if (!result) return {};
  const [message, line] = result.toJs();
  result.destroy();
  return { error: message, line };
}

// A function of the console's language module (_console_python), once CPython has loaded, in the console's context.
export function consoleCall(editor, name, ...args) {
  return inArea(editor.area, () => {
    const context = editor.context();
    useContext(context);
    return loaded.console(name, context, ...args);
  });
}
