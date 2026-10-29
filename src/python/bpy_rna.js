// Blender's bpy_rna.cc and bpy_props.cc over the module's RNA (tools/blender-port/wasm/rna-bridge.cc): Blender's data
// and types as Python objects for its transpiled scripts (src/bl_py). A struct is an instance of its bpy.types class whose
// attributes that start with a letter read and write its RNA properties, call its RNA functions or, on a Context, give
// the context's members, as pyrna_struct_getattro gives them; Python's own attributes (methods, class attributes) are
// the class's. A registered class (Panel, Menu, Header, UIList, ...) becomes an RNA type whose functions Blender's code
// calls back here (bpy_class_call), on an instance of the class over the struct Blender passes.
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { provided } from '../port/wasm.js';
import { set, tuple, bool, AttributeError, py_TypeError, ValueError, KeyError, IndexError, Exception } from '../bl_py/org.transcrypt.__runtime__.js';

const { exports: x } = blenderModule;
const encoder = new TextEncoder(), decoder = new TextDecoder();

// PropertyType, FunctionFlag, ParameterFlag and bpy_property_info's flags (RNA_types.hh, rna-bridge.cc).
const BOOLEAN = 0, INT = 1, FLOAT = 2, STRING = 3, ENUM = 4, POINTER = 5, COLLECTION = 6;
const FUNC_NO_SELF = 1, FUNC_REGISTER_OPTIONAL = 32 | 64;
const PARM_REQUIRED = 1, PARM_OUTPUT = 2;
const PROP_REGISTER_OPTIONAL = 16 | 32;
const INFO_ENUM_FLAG = 1, INFO_EDITABLE = 2;

// ---- The module's memory: strings in a block reused by nested calls in turn, numbers in a scratch array, structs
// from bpy_out.
const ARENA = 1 << 16;
const arena = x.malloc(ARENA) >>> 0;
let arenaTop = 0;
function withText(texts, fn) {
  const mark = arenaTop, own = [];
  const pointers = texts.map((text) => {
    const bytes = encoder.encode(String(text) + '\0');
    let p;
    if (arenaTop + bytes.length <= ARENA) {
      p = arena + arenaTop;
      arenaTop += (bytes.length + 7) & ~7;
    } else own.push((p = x.malloc(bytes.length) >>> 0));
    new Uint8Array(x.memory.buffer, p, bytes.length).set(bytes);
    return p;
  });
  try {
    return fn(...pointers);
  } finally {
    arenaTop = mark;
    own.forEach((p) => x.free(p));
  }
}
const cString = (pointer) => {
  if (!pointer) return null;
  const bytes = new Uint8Array(x.memory.buffer, pointer >>> 0);
  return decoder.decode(bytes.subarray(0, bytes.indexOf(0)));
};
let numbersCapacity = 64, numbersPointer = x.malloc(8 * numbersCapacity) >>> 0;
const numbers = () => new Float64Array(x.memory.buffer, numbersPointer, numbersCapacity);
function ensureNumbers(length) {
  if (length <= numbersCapacity) return;
  x.free(numbersPointer);
  numbersCapacity = Math.max(length, 2 * numbersCapacity);
  numbersPointer = x.malloc(8 * numbersCapacity) >>> 0;
}
const outPointer = x.bpy_out() >>> 0;
const out = () => new Uint32Array(x.memory.buffer, outPointer, 5);
const outStruct = () => { const o = out(); return [o[0], o[1], o[2]]; };

// The context RNA calls and updates run in (BPY_context_get), set by whoever draws or runs Python. With nothing else
// set, bpy.context and bpy.data are this context's, as Blender's window manager context is.
let C = 0;
const bpy = () => globalThis.__py_modules?._bpy;
export function setContextPointer(pointer) {
  C = pointer;
  const _bpy = bpy();
  if (_bpy) [_bpy._contexts[0], _bpy._datas[0]] = [contextStruct(C), blendData(C)];
}
export const contextPointer = () => C;

// fn() with bpy.context and bpy.data those of the context C (bpy_context_set), for Python run or drawn in it.
export function inPythonContext(CPointer, fn) {
  const previous = C, _bpy = bpy();
  C = CPointer >>> 0;
  _bpy?._context_push(contextStruct(C), blendData(C));
  try {
    return fn();
  } finally {
    _bpy?._context_pop();
    C = previous;
  }
}

// Transcrypt renames Python names its runtime uses (type becomes py_metatype, others take a py_ prefix).
const rnaName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));

// ---- Types.
const identifiers = new Map();
export const structIdentifier = (type) => identifiers.get(type) ?? identifiers.set(type, cString(x.bpy_struct_identifier(type))).get(type);
export const structFind = (name) => withText([name], (p) => x.rna_struct_find(p) >>> 0);
const baseOf = (type) => x.bpy_struct_base(type) >>> 0;
// A struct's type and its bases, by identifier (Object, ID).
export function structNames(value) {
  const names = [];
  for (let type = pointerOf(value)?.[0]; type; type = baseOf(type)) names.push(structIdentifier(type));
  return names;
}

// Registered classes by the id their type keeps (RNA_struct_py_type_get), and each class's type.
const classes = [null];
const typeOfClass = new Map();
const bpyTypes = () => globalThis.__py_modules?.['_bpy.types'] ?? {};
// The class of a struct of `type`: its registered class, else the bpy.types class of its type or nearest base.
function classOf(type) {
  const registered = x.bpy_struct_class(type);
  if (registered) return classes[registered];
  for (let t = type; t; t = baseOf(t)) {
    const cls = Object.hasOwn(bpyTypes(), structIdentifier(t)) && bpyTypes()[structIdentifier(t)];
    if (cls) return cls;
  }
  return bpyTypes().bpy_struct ?? Object;
}

// Properties and functions by type and name; found ones are kept (a type's own do not change once registered).
const properties = new Map(), functions = new Map(), functionInfos = new Map();
function findProperty([type, id, data], name) {
  let byName = properties.get(type);
  if (!byName) properties.set(type, (byName = new Map()));
  if (byName.has(name)) return byName.get(name);
  const prop = withText([name], (p) => x.bpy_property(type, id, data, p) >>> 0);
  if (prop) byName.set(name, prop);
  return prop;
}
function findFunction(type, name) {
  let byName = functions.get(type);
  if (!byName) functions.set(type, (byName = new Map()));
  if (!byName.has(name)) byName.set(name, withText([name], (p) => x.bpy_function(type, p) >>> 0));
  return byName.get(name);
}
const functionInfo = (func) => functionInfos.get(func) ?? functionInfos.set(func, JSON.parse(cString(x.bpy_function_info(func)))).get(func);

// A property's type with its subtype, array length, flags and the struct it holds.
function propertyInfo([type, id, data], prop) {
  const kind = x.bpy_property_info(type, id, data, prop);
  const [subtype, length, flags, struct] = out();
  return { kind, subtype, length, flags, struct };
}

// ---- Structs (pyrna_struct_CreatePyObject): one object per struct while it is in use, so identity holds.
const POINTER_RNA = Symbol('PointerRNA');
export const pointerOf = (struct) => struct?.[POINTER_RNA] ?? null;
const live = new Map();
const keyOf = (type, data) => `${type}:${data}`;
const finalizer = new FinalizationRegistry((key) => { if (!live.get(key)?.deref()) live.delete(key); });

export function struct(type, id, data) {
  if (!data) return null;
  [type, id, data] = [type >>> 0, id >>> 0, data >>> 0];
  const key = keyOf(type, data), existing = live.get(key)?.deref();
  if (existing) return existing;
  const cls = classOf(type);
  const target = Object.create(cls, { __class__: { value: cls, enumerable: true, writable: true } });
  target[POINTER_RNA] = [type, id, data];
  const proxy = new Proxy(target, structHandler);
  target.__proxy__ = proxy;
  live.set(key, new WeakRef(proxy));
  finalizer.register(proxy, key);
  return proxy;
}
const fromOut = () => struct(...outStruct());

// Context members (CTX_data_get), as pyrna_struct_getattro gives them; undefined for a name that is not one.
function contextMember(C, name) {
  const kind = withText([name], (p) => x.bpy_context_member(C, p));
  switch (kind) {
    case -1: return null;
    case 1: return fromOut();
    case 2: return Array.from({ length: x.bpy_context_length() }, (_, i) => { x.bpy_context_item(i); return fromOut(); });
    case 4: return cString(x.bpy_context_string()) || null;
    case 5: return x.bpy_context_int();
    case 3: return null;
    default: return undefined;
  }
}

// A property's value from a path (path_resolve): coerced to its Python value, or its element at an index.
function resolvePath(ptr, path) {
  const kind = withText([path], (p) => x.bpy_path_resolve(...ptr, p));
  if (!kind) throw ValueError(`${structIdentifier(ptr[0])}.path_resolve("${path}") could not be resolved`);
  const owner = outStruct(), [, , , prop, index] = out();
  if (kind === 1) return struct(...owner);
  const value = propertyGet(owner, prop);
  return index !== 0xffffffff && value?.__getitem__ ? value.__getitem__(index) : value;
}
const idpropKeys = (ptr) => JSON.parse(cString(x.bpy_idprop_keys(...ptr)));
const quoted = (key) => `["${String(key).replace(/["\\]/g, '\\$&')}"]`;

// bpy_struct's own methods (bpy_rna.cc's pyrna_struct_methods), under the class's: custom properties by key, paths and
// whether a property is set.
const STRUCT_METHODS = {
  path_resolve: (ptr) => (path) => resolvePath(ptr, path),
  is_property_set: (ptr) => (name) => { const prop = findProperty(ptr, name); return !!prop && x.bpy_property_is_set(...ptr, prop); },
  property_unset: (ptr) => (name) => { const prop = findProperty(ptr, name); if (prop) x.bpy_property_unset(...ptr, prop); },
  path_from_id: (ptr) => (name) => cString(x.bpy_path_from_id(...ptr, name ? findProperty(ptr, name) : 0)),
  as_pointer: (ptr) => () => ptr[2],
  id_data: (ptr) => (ptr[1] ? idStruct(ptr[1]) : null),
  keys: (ptr) => () => idpropKeys(ptr),
  values: (ptr) => () => idpropKeys(ptr).map((key) => resolvePath(ptr, quoted(key))),
  items: (ptr) => () => idpropKeys(ptr).map((key) => tuple([key, resolvePath(ptr, quoted(key))])),
  get: (ptr) => (key, fallback = null) => (idpropKeys(ptr).includes(key) ? resolvePath(ptr, quoted(key)) : fallback),
  __getitem__: (ptr) => (key) => { if (!idpropKeys(ptr).includes(key)) throw KeyError(`bpy_struct[key]: key "${key}" not found`); return resolvePath(ptr, quoted(key)); },
  __contains__: (ptr) => (key) => idpropKeys(ptr).includes(key),
  __eq__: (ptr) => (other) => { const o = pointerOf(other); return !!o && o[0] === ptr[0] && o[2] === ptr[2]; },
  __ne__: (ptr) => (other) => { const o = pointerOf(other); return !o || o[0] !== ptr[0] || o[2] !== ptr[2]; },
  __hash__: (ptr) => () => ptr[2],
};

const isContext = (ptr) => structIdentifier(ptr[0]) === 'Context';
// An operator's own properties read and written on the operator, as _bpy_types.Operator's __getattribute__ and
// __setattr__ give them (Transcrypt has neither hook).
const operatorTypes = new Map();
const isOperator = (type) => operatorTypes.get(type) ?? operatorTypes.set(type, x.bpy_struct_is_a(type, structFind('Operator'))).get(type);
function operatorProperty(ptr, name) {
  if (!isOperator(ptr[0])) return null;
  const properties = pointerOf(propertyGet(ptr, findProperty(ptr, 'properties')));
  const prop = properties && findProperty(properties, name);
  return prop ? [properties, prop] : null;
}

const structHandler = {
  get(target, key, receiver) {
    if (typeof key !== 'string' || (key.startsWith('_') && !(key in STRUCT_METHODS))) return Reflect.get(target, key, receiver);
    const ptr = target[POINTER_RNA], name = rnaName(key);
    if (!key.startsWith('_')) {
      const prop = findProperty(ptr, name);
      if (prop) return propertyGet(ptr, prop);
      const own = operatorProperty(ptr, name);
      if (own) return propertyGet(...own);
      const func = findFunction(ptr[0], name);
      if (func && functionInfo(func).defined) return (...args) => callFunction(ptr, func, args);
      if (isContext(ptr)) {
        const member = contextMember(ptr[2], name);
        if (member !== undefined) return member;
      }
      if (name === 'bl_rna') return structRna(ptr[0]);
    }
    if (key in target || !(name in STRUCT_METHODS)) return Reflect.get(target, key, receiver);
    return STRUCT_METHODS[name](ptr);
  },
  set(target, key, value, receiver) {
    if (typeof key === 'string' && !key.startsWith('_')) {
      const ptr = target[POINTER_RNA], prop = findProperty(ptr, rnaName(key));
      const own = prop ? [ptr, prop] : operatorProperty(ptr, rnaName(key));
      if (own) {
        propertySet(...own, value, rnaName(key));
        return true;
      }
    }
    if (!Reflect.set(target, key, value, receiver)) throw AttributeError(`bpy_struct: attribute "${key}" from "${structIdentifier(target[POINTER_RNA][0])}" is read-only`);
    return true;
  },
  has(target, key) {
    if (typeof key !== 'string' || key.startsWith('_') || key in target) return key in target;
    const ptr = target[POINTER_RNA], name = rnaName(key);
    return !!findProperty(ptr, name) || !!operatorProperty(ptr, name) || !!findFunction(ptr[0], name) || name in STRUCT_METHODS
      || (isContext(ptr) && contextMember(ptr[2], name) !== undefined);
  },
};

// The struct's own RNA, as `bl_rna` and `rna_type` give it.
export const structRna = (type) => struct(structFind('Struct'), 0, type);

// ---- Properties (pyrna_prop_to_py, pyrna_py_to_prop).
function readNumbers([type, id, data], prop, length) {
  ensureNumbers(Math.max(length, 1));
  const n = x.bpy_numbers_get(type, id, data, prop, numbersPointer, numbersCapacity);
  return Array.from(numbers().subarray(0, n));
}
function propertyGet(ptr, prop) {
  const { kind, length, flags } = propertyInfo(ptr, prop);
  const [type, id, data] = ptr;
  switch (kind) {
    case BOOLEAN: case INT: case FLOAT: {
      if (length) return propArray(ptr, prop);
      const [value] = readNumbers(ptr, prop, 1);
      return kind === BOOLEAN ? !!value : value;
    }
    case STRING: return cString(x.bpy_string_get(type, id, data, prop));
    case ENUM: {
      const text = cString(x.bpy_enum_get(C, type, id, data, prop));
      return flags & INFO_ENUM_FLAG ? set(text ? text.split(',') : []) : text;
    }
    case POINTER: return x.bpy_pointer_get(type, id, data, prop) ? fromOut() : null;
    case COLLECTION: return propCollection(ptr, prop);
  }
  return null;
}

// A number, or a sequence of them (a mathutils value keeps its own in `values`); None is false.
const numberList = (value) => (value == null || typeof value === 'number' || typeof value === 'boolean' ? [Number(value ?? 0)]
  : Array.from(Array.isArray(value?.values) ? value.values : value, Number));
const enumText = (value) => (typeof value === 'string' ? value : Array.from(value).join(','));

function propertySet(ptr, prop, value, name) {
  const { kind, flags } = propertyInfo(ptr, prop);
  if (!(flags & INFO_EDITABLE)) throw AttributeError(`bpy_struct: attribute "${name}" from "${structIdentifier(ptr[0])}" is read-only`);
  writeProperty(ptr, prop, kind, flags, value, -1);
}
function writeProperty([type, id, data], prop, kind, flags, value, index) {
  switch (kind) {
    case BOOLEAN: case INT: case FLOAT: {
      const list = numberList(value);
      ensureNumbers(list.length);
      numbers().set(list);
      x.bpy_numbers_set(C, type, id, data, prop, index, numbersPointer, list.length);
      return;
    }
    case STRING: withText([value ?? ''], (p) => x.bpy_string_set(C, type, id, data, prop, p)); return;
    case ENUM:
      if (!withText([enumText(value)], (p) => x.bpy_enum_set(C, type, id, data, prop, p))) {
        throw py_TypeError(`bpy_struct: item.attr = val: enum "${value}" not found in ${cString(x.bpy_property_identifier(prop))}`);
      }
      return;
    case POINTER: {
      const [vtype, vid, vdata] = pointerOf(value) ?? [0, 0, 0];
      if (value != null && !pointerOf(value)) throw py_TypeError('bpy_struct: expected a bpy_struct');
      x.bpy_pointer_set(C, type, id, data, prop, vtype, vid, vdata);
      return;
    }
    default:
      throw AttributeError('bpy_struct: a collection cannot be assigned');
  }
}

// Array properties (bpy_prop_array): the values when read, an element's set written through; vectors and colors
// also by letter, as mathutils gives them.
const LETTERS = ['xyzw', 'rgba'];
function propArray(ptr, prop) {
  const { kind, subtype } = propertyInfo(ptr, prop);
  const values = readNumbers(ptr, prop, propertyInfo(ptr, prop).length).map((v) => (kind === BOOLEAN ? !!v : v));
  const setIndex = (i, value) => {
    writeProperty(ptr, prop, kind, 0, value, i);
    values[i] = kind === BOOLEAN ? !!value : value;
  };
  const low = subtype & 0xffff, letters = low === 20 || low === 30 ? LETTERS[1] : LETTERS[0];
  const item = (i) => {
    const index = i < 0 ? values.length + i : i;
    if (index < 0 || index >= values.length) throw IndexError('bpy_prop_array[index]: index out of range');
    return values[index];
  };
  const methods = {
    __len__: () => values.length,
    __getitem__: (key) => (Array.isArray(key) ? values.slice(key[0] ?? 0, key[1] ?? values.length) : item(key)),
    __setitem__: (key, value) => {
      if (Array.isArray(key)) numberList(value).forEach((v, i) => setIndex((key[0] ?? 0) + i, v));
      else setIndex(key < 0 ? values.length + key : key, value);
    },
    to_tuple: () => tuple(values),
    copy: () => [...values],
  };
  return new Proxy(values, {
    get(target, key) {
      if (key in methods) return methods[key];
      if (typeof key === 'string' && key.length === 1 && letters.includes(key)) return target[letters.indexOf(key)];
      return target[key];
    },
    set(target, key, value) {
      if (typeof key === 'string' && key.length === 1 && letters.includes(key)) setIndex(letters.indexOf(key), value);
      else if (/^\d+$/.test(key)) setIndex(+key, value);
      else target[key] = value;
      return true;
    },
  });
}

const OWNED_FIRST = new Set(['add', 'remove', 'clear', 'move']);
const PROP_COLLECTION = Symbol('bpy_prop_collection');
export const isCollection = (value) => !!value?.[PROP_COLLECTION];
// A struct's name (RNA_struct_name_get_alloc: its name property), '' without one.
export const structName = (value) => cString(x.bpy_struct_name(...pointerOf(value)));

// Collections (bpy_prop_collection): items by index and by name, and the functions and properties of the collection's
// own struct (bpy.data.objects.new) over its owner.
function propCollection(ptr, prop) {
  const [type, id, data] = ptr;
  const length = () => x.bpy_collection_length(type, id, data, prop);
  const at = (i) => (x.bpy_collection_index(type, id, data, prop, i) ? fromOut() : null);
  const byName = (key) => withText([key], (p) => x.bpy_collection_key(type, id, data, prop, p)) ? fromOut() : null;
  const all = () => Array.from({ length: length() }, (_, i) => at(i));
  const nameOf = structName;
  let functionsStruct;
  const owner = () => (functionsStruct ??= x.bpy_collection_functions(type, id, data, prop) ? fromOut() : null);
  const methods = {
    __len__: length,
    __bool__: () => length() > 0,
    __getitem__(key) {
      if (Array.isArray(key)) return all().slice(key[0] ?? 0, key[1] ?? undefined);
      if (typeof key === 'string') {
        const item = byName(key);
        if (!item) throw KeyError(`bpy_prop_collection[key]: key "${key}" not found`);
        return item;
      }
      const n = length(), item = at(key < 0 ? n + key : key);
      if (!item) throw IndexError(`bpy_prop_collection[index]: index ${key} out of range, size ${n}`);
      return item;
    },
    __contains__: (key) => (typeof key === 'string' ? !!byName(key) : all().some((item) => item === key)),
    __iter__: () => all()[Symbol.iterator](),
    [Symbol.iterator]: () => all()[Symbol.iterator](),
    get: (key, fallback = null) => byName(key) ?? fallback,
    keys: () => all().map(nameOf),
    values: all,
    items: () => all().map((item) => tuple([nameOf(item), item])),
    find: (key) => all().findIndex((item) => nameOf(item) === key),
    add() { x.bpy_collection_add(type, id, data, prop); return fromOut(); },
    remove: (index) => x.bpy_collection_remove(type, id, data, prop, index),
    clear: () => x.bpy_collection_clear(type, id, data, prop),
    foreach_get(attr, sequence) { all().forEach((item, i) => { sequence[i] = item[attr]; }); },
    foreach_set(attr, sequence) { all().forEach((item, i) => { item[attr] = sequence[i]; }); },
  };
  return new Proxy(methods, {
    get(target, key) {
      // As a struct (a parameter's data), the collection is its own struct over its owner (LayerObjects).
      if (key === POINTER_RNA) return pointerOf(owner());
      if (key === PROP_COLLECTION) return true;
      if (key === 'length') return length();
      if (typeof key === 'string' && /^\d+$/.test(key)) return at(+key);
      // The collection's own functions (BlendDataObjects.remove) come first, as pyrna_prop_collection_getattro looks
      // them up: the generic add, remove and clear are an ID property collection's.
      if (OWNED_FIRST.has(key) && owner() && findFunction(pointerOf(owner())[0], key)) return owner()[key];
      if (key in target) return target[key];
      if (typeof key === 'string' && key.startsWith('py_') && rnaName(key) in target) return target[rnaName(key)];
      return typeof key === 'string' ? owner()?.[key] : undefined;
    },
    set(target, key, value) {
      if (owner()) owner()[key] = value;
      return true;
    },
    has: (target, key) => key in target || (typeof key === 'string' && !!owner() && key in owner()),
  });
}

// ---- Functions (pyrna_func_call): Python's positional and keyword arguments into a ParameterList, its outputs back.
function pythonArguments(args) {
  const last = args.at(-1), keywords = last && typeof last === 'object' && Object.hasOwn(last, '__kwargtrans__') ? last : null;
  return { positional: keywords ? args.slice(0, -1) : args, keywords: keywords ?? {} };
}
const keyword = (keywords, name) => keywords[name] ?? keywords['py_' + name] ?? (name === 'type' ? keywords.py_metatype : undefined);

function setParameter(parms, index, [, kind, flags, , length], value) {
  switch (kind) {
    case BOOLEAN: case INT: case FLOAT: {
      // A boolean is Python's truth of the value (poll returning the object it found).
      const list = kind === BOOLEAN && !length ? [Number(bool(value))] : numberList(value);
      ensureNumbers(list.length);
      numbers().set(list);
      x.bpy_param_numbers_set(parms, index, numbersPointer, list.length);
      return;
    }
    case STRING: withText([value ?? ''], (p) => x.bpy_param_string_set(parms, index, p)); return;
    case ENUM:
      if (!withText([enumText(value)], (p) => x.bpy_param_enum_set(C, parms, index, p))) throw py_TypeError(`enum "${value}" not found`);
      return;
    case POINTER: {
      if (value != null && !pointerOf(value)) throw py_TypeError(`expected a bpy_struct, not ${typeof value}`);
      const [type, id, data] = pointerOf(value) ?? [0, 0, 0];
      x.bpy_param_pointer_set(parms, index, type, id, data);
      return;
    }
    case COLLECTION:
      for (const item of value ?? []) x.bpy_param_collection_append(parms, index, ...pointerOf(item));
  }
}
function getParameter(parms, index, [, kind, flags, , length]) {
  switch (kind) {
    case BOOLEAN: case INT: case FLOAT: {
      ensureNumbers(256);
      const n = x.bpy_param_numbers_get(parms, index, numbersPointer, numbersCapacity);
      const values = Array.from(numbers().subarray(0, n), kind === BOOLEAN ? Boolean : Number);
      return length || flags & 8 ? values : values[0];
    }
    case STRING: return cString(x.bpy_param_string_get(parms, index));
    case ENUM: {
      const text = cString(x.bpy_param_enum_get(C, parms, index));
      return flags & INFO_ENUM_FLAG ? set(text ? text.split(',') : []) : text;
    }
    case POINTER: return x.bpy_param_pointer_get(parms, index) ? fromOut() : null;
    case COLLECTION:
      return Array.from({ length: x.bpy_param_collection_length(parms, index) }, (_, i) => { x.bpy_param_collection_item(parms, index, i); return fromOut(); });
  }
  return null;
}

function callFunction(ptr, func, args) {
  const { parameters } = functionInfo(func);
  const { positional, keywords } = pythonArguments(args);
  const parms = x.bpy_call_begin(...ptr, func) >>> 0;
  try {
    let next = 0;
    const outputs = [];
    parameters.forEach((parameter, index) => {
      const [name, , , pflag] = parameter;
      if (pflag & PARM_OUTPUT) return outputs.push(index);
      const value = next < positional.length ? positional[next++] : keyword(keywords, name);
      if (value === undefined) {
        if (pflag & PARM_REQUIRED) throw py_TypeError(`${structIdentifier(ptr[0])}: required parameter "${name}" not specified`);
        return;
      }
      setParameter(parms, index, parameter, value);
    });
    const error = cString(x.bpy_call(C, ...ptr, func, parms));
    if (error) throw Exception(error);
    const results = outputs.map((index) => getParameter(parms, index, parameters[index]));
    return results.length === 0 ? null : results.length === 1 ? results[0] : tuple(results);
  } finally {
    x.bpy_call_end(parms);
  }
}

// A Python exception as Python prints it, its class and message, with the JS stack it was raised at.
const pythonError = (error) => (error?.__args__ ? `${error.__class__?.__name__}: ${error.__args__[0]}\n${error.stack ?? ''}` : error);

// ---- Registration (pyrna_register_class and its callbacks, bpy_class_validate and bpy_class_call).
const registrable = new Map();
const registrableOf = (type) => registrable.get(type) ?? registrable.set(type, JSON.parse(cString(x.bpy_struct_registrable(type)))).get(type);

// The RNA type a class registers under: the type of its nearest base that is RNA's or registered.
function baseType(cls) {
  for (const base of cls.__bases__ ?? []) {
    if (typeOfClass.has(base)) return typeOfClass.get(base);
    const type = Object.hasOwn(bpyTypes(), base.__name__) && bpyTypes()[base.__name__] === base ? structFind(base.__name__) : 0;
    if (type) return type;
    const deeper = baseType(base);
    if (deeper) return deeper;
  }
  return 0;
}

// bpy_class_validate: which of the type's callbacks the class has, and its settings (bl_idname, bl_label, ...) on the
// dummy struct the type's register function reads them from.
provided.bpy_class_validate = (id, type, owner, data, haveFunction) => {
  const cls = classes[id], ptr = [type >>> 0, owner >>> 0, data >>> 0];
  try {
    const { functions: funcs, properties: props } = registrableOf(ptr[0]);
    const have = new Uint8Array(x.memory.buffer, haveFunction >>> 0, funcs.length);
    funcs.forEach(([name, flag], i) => {
      have[i] = typeof cls[name] === 'function' ? 1 : 0;
      if (!have[i] && (flag & FUNC_REGISTER_OPTIONAL) !== FUNC_REGISTER_OPTIONAL) throw AttributeError(`expected ${cls.__name__} class to have an "${name}" attribute`);
    });
    for (const [name, flag] of props) {
      const value = cls[name] ?? (name === 'bl_idname' ? cls.__name__ : name === 'bl_description' ? cls.__doc__ : undefined);
      if (value == null) {
        if ((flag & PROP_REGISTER_OPTIONAL) !== PROP_REGISTER_OPTIONAL) throw AttributeError(`expected ${cls.__name__} class to have an "${name}" attribute`);
        continue;
      }
      const prop = findProperty(ptr, name), { kind, flags } = propertyInfo(ptr, prop);
      writeProperty(ptr, prop, kind, flags, value, -1);
    }
    return 0;
  } catch (error) {
    console.error(`Python: registering ${cls?.__name__}:`, pythonError(error));
    return -1;
  }
};

// bpy_class_call: a callback of a registered class, on an instance over the struct (kept with the data where the type
// keeps one, an operator's), or on the class for a class method; its result written to the function's output.
// bpy.context is the callback's context while it runs (bpy_context_set), for scripts that read it.
provided.bpy_class_call = (CPointer, type, owner, data, func, parms) => inPythonContext(CPointer, () => {
  const ptr = [type >>> 0, owner >>> 0, data >>> 0], cls = classes[x.bpy_struct_class(ptr[0])];
  const { flag, parameters } = functionInfo(func >>> 0);
  try {
    const args = [], outputs = [];
    parameters.forEach((parameter, index) => (parameter[3] & PARM_OUTPUT ? outputs.push(index) : args.push(getParameter(parms >>> 0, index, parameter))));
    const method = functionName(func >>> 0);
    const self = flag & FUNC_NO_SELF ? cls : instance(ptr, cls);
    const result = self[method](...args);
    if (outputs.length === 1) setParameter(parms >>> 0, outputs[0], parameters[outputs[0]], result);
    else outputs.forEach((index, i) => setParameter(parms >>> 0, index, parameters[index], result[i]));
    return 0;
  } catch (error) {
    console.error(`Python: ${cls?.__name__}.${functionName(func >>> 0)}:`, pythonError(error));
    return -1;
  }
});
provided.bpy_class_free = (id) => {
  typeOfClass.delete(classes[id]);
  classes[id] = null;
};

// A function's identifier, by the struct of FunctionRNA.
const functionNames = new Map();
function functionName(func) {
  if (!functionNames.has(func)) functionNames.set(func, struct(structFind('Function'), 0, func).identifier);
  return functionNames.get(func);
}

// The instance a callback runs on: kept with the data when its type keeps one (an operator's, RNA_struct_instance), for
// its next callbacks (invoke, then modal), else the struct.
const kept = [null];
function instance(ptr, cls) {
  const id = x.bpy_instance(...ptr);
  if (id > 0) return kept[id];
  const self = struct(...ptr);
  if (cls.__init__ && cls.__init__ !== bpyTypes().bpy_struct?.__init__) cls.__init__(self);
  if (id === 0) x.bpy_instance_set(...ptr, kept.push(self) - 1);
  return self;
}

// An operator class's declared properties go on its operator's properties (bpy_operator_wrap.cc's
// operator_properties_init), its bl_property its main one.
const definedByType = new Set();
provided.bpy_class_define = (id, srna, ot) => {
  const cls = classes[id];
  definedByType.add(cls);
  defineProperties(srna >>> 0, cls);
  const main = Object.getOwnPropertyDescriptor(cls, 'bl_property')?.value;
  if (typeof main === 'string') withText([main], (p) => x.bpy_operator_property_set(ot, p));
};

// Registers a class as Blender's register_class does; returns its type.
export function registerClass(cls) {
  const base = baseType(cls);
  if (!base) throw ValueError(`register_class(...): expected a subclass of a registerable RNA type (${cls.__name__})`);
  const id = classes.push(cls) - 1;
  const type = withText([cls.__name__], (p) => x.bpy_register(C, base, id, p) >>> 0);
  if (!type) {
    classes[id] = null;
    throw ValueError(`register_class(...): ${cString(x.bpy_register_error())}`);
  }
  typeOfClass.set(cls, type);
  if (!definedByType.has(cls)) defineProperties(type, cls);
  return type;
}
export function unregisterClass(cls) {
  const type = typeOfClass.get(cls);
  if (type) x.bpy_unregister(C, type);
  properties.clear();
}
export const classType = (cls) => typeOfClass.get(cls) ?? 0;

// ---- Properties a class defines (bpy_props.cc): its annotations, its bases' first, as RNA properties of its type.
const SUBTYPES = { NONE: 0, FILE_PATH: 1, DIR_PATH: 2, FILE_NAME: 3, BYTE_STRING: 4, PASSWORD: 6, PIXEL: 12, UNSIGNED: 13, PERCENTAGE: 14,
  FACTOR: 15, ANGLE: 16 | (5 << 16), TIME: 17 | (6 << 16), TIME_ABSOLUTE: 17 | (7 << 16), DISTANCE: 18 | (1 << 16), DISTANCE_CAMERA: 19 | (10 << 16),
  COLOR: 20, TRANSLATION: 21 | (1 << 16), DIRECTION: 22, VELOCITY: 23 | (8 << 16), ACCELERATION: 24 | (9 << 16), MATRIX: 25,
  EULER: 26 | (5 << 16), QUATERNION: 27, AXISANGLE: 28, XYZ: 29, XYZ_LENGTH: 29 | (1 << 16), COLOR_GAMMA: 30, COORDINATES: 31, LAYER: 40,
  LAYER_MEMBER: 41, POWER: 42 | (11 << 16), TEMPERATURE: 43 | (12 << 16), WAVELENGTH: 44 | (13 << 16), COLOR_TEMPERATURE: 45 | (14 << 16),
  FREQUENCY: 46 | (15 << 16), PIXEL_DIAMETER: 47, DISTANCE_DIAMETER: 48 | (1 << 16), MASS: 49 | (4 << 16) };
const UNITS = { NONE: 0, LENGTH: 1, AREA: 2, VOLUME: 3, MASS: 4, ROTATION: 5, TIME: 6, TIME_ABSOLUTE: 7, VELOCITY: 8, ACCELERATION: 9, CAMERA: 10,
  POWER: 11, TEMPERATURE: 12, WAVELENGTH: 13, COLOR_TEMPERATURE: 14, FREQUENCY: 15 };
const OPTIONS = { HIDDEN: 1 << 19, SKIP_SAVE: 1 << 28, SKIP_PRESET: 1 << 11, ANIMATABLE: 1 << 1, LIBRARY_EDITABLE: 1 << 16, PROPORTIONAL: 1 << 26,
  TEXTEDIT_UPDATE: 1 << 31, OUTPUT_PATH: 1 << 2, PATH_SUPPORTS_BLEND_RELATIVE: 1 << 15, PATH_SUPPORTS_TEMPLATES: 1 << 14 };
const KINDS = { BoolProperty: BOOLEAN, BoolVectorProperty: BOOLEAN, IntProperty: INT, IntVectorProperty: INT, FloatProperty: FLOAT,
  FloatVectorProperty: FLOAT, StringProperty: STRING, EnumProperty: ENUM, PointerProperty: POINTER, CollectionProperty: COLLECTION };

function annotations(cls, seen = new Map()) {
  for (const base of cls.__bases__ ?? []) if (!typeOfClass.has(base) && !(Object.hasOwn(bpyTypes(), base.__name__))) annotations(base, seen);
  for (const [name, value] of Object.entries(Object.getOwnPropertyDescriptor(cls, '__annotations__')?.value ?? {})) seen.set(name, value);
  return seen;
}

function defineProperties(type, cls) {
  for (const [name, deferred] of annotations(cls)) {
    const kind = KINDS[deferred?.function?.name];
    if (kind !== undefined) defineProperty(type, name, deferred.function.name, kind, deferred.keywords ?? {});
  }
  properties.clear();
}

// Its identifier and texts stay in the module's memory until RNA_def_property_duplicate_pointers copies them.
function defineProperty(type, name, functionName, kind, kw) {
  const size = /Vector/.test(functionName) ? kw.size ?? 3 : 0;
  const subtype = (SUBTYPES[kw.subtype ?? 'NONE'] ?? 0) | ((UNITS[kw.unit ?? 'NONE'] ?? 0) << 16);
  const options = new Set(kw.options ? Array.from(kw.options) : ['ANIMATABLE']);
  withText([name, kw.name ?? name, kw.description ?? ''], (n, label, description) => {
    const prop = kind === POINTER || kind === COLLECTION
      ? x.bpy_def_pointer(type, n, kind === COLLECTION, typeOfClass.get(kw.type) ?? structFind(kw.type?.__name__ ?? 'PropertyGroup'), label, description) >>> 0
      : x.bpy_def_property(type, n, kind, subtype, typeof size === 'number' ? size : 0, label, description) >>> 0;
    if (kind === ENUM) defineEnum(prop, kw, options);
    else if (kind === STRING) withText([kw.default ?? ''], (p) => x.bpy_def_string_default(prop, p, kw.maxlen ?? 0));
    else if (kind !== POINTER && kind !== COLLECTION) defineNumber(prop, kind, kw);
    const flags = [...options].reduce((bits, option) => bits | (OPTIONS[option] ?? 0), 0);
    x.bpy_def_property_done(type, prop, flags, options.has('ANIMATABLE') ? 0 : OPTIONS.ANIMATABLE);
  });
}

function defineNumber(prop, kind, kw) {
  if (kw.default !== undefined) {
    const list = numberList(kw.default);
    ensureNumbers(list.length);
    numbers().set(list);
    x.bpy_def_defaults(prop, numbersPointer, list.length);
  }
  if (kind === BOOLEAN) return;
  const [hardMin, hardMax] = kind === INT ? [-(2 ** 31), 2 ** 31 - 1] : [-Number.MAX_VALUE, Number.MAX_VALUE];
  const min = kw.min ?? hardMin, max = kw.max ?? hardMax;
  x.bpy_def_range(prop, min, max, kw.soft_min ?? min, kw.soft_max ?? max, kw.step ?? (kind === INT ? 1 : 3), kw.precision ?? 3);
}

function defineEnum(prop, kw, options) {
  const flag = options.has('ENUM_FLAG');
  const items = typeof kw.items === 'function' ? [] : Array.from(kw.items ?? []).filter(Boolean);
  const values = items.map((item, i) => (item.length >= 5 ? item[4] : item.length === 4 && typeof item[3] === 'number' ? item[3] : flag ? 1 << i : i));
  const lines = items.map((item, i) => [item[0], item[1] ?? item[0], item[2] ?? '', item.length >= 5 || typeof item[3] === 'string' ? item[3] : 'NONE', values[i]].join('\t')).join('\n');
  const defaults = kw.default == null ? [] : typeof kw.default === 'string' ? [kw.default] : Array.from(kw.default);
  const value = typeof kw.default === 'number' ? kw.default : defaults.reduce((bits, id) => bits | (values[items.findIndex((item) => item[0] === id)] ?? 0), 0);
  withText([lines], (p) => x.bpy_def_enum_items(prop, p, flag, flag || defaults.length ? value : values[0] ?? 0));
}

// ---- Entry points: bpy.data and bpy.context over a context.
export const blendData = (CPointer = C) => { x.bpy_main(CPointer); return fromOut(); };
export const contextStruct = (CPointer = C) => { x.bpy_context(CPointer); return fromOut(); };
export const idStruct = (id) => { x.bpy_id_pointer(id); return fromOut(); };
export const pointerStruct = (type, id, data) => { x.bpy_pointer(type, id, data); return fromOut(); };
