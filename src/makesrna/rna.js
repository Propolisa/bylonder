// Blender's data as its UI scripts read it (src/bl_ui): a struct is the data Bylonder binds, under Blender's property
// names, and every property it does not bind reads as Blender's default (rna-structs.json, from Blender itself): a
// pointer as None, or the struct's defaults when Blender's never is None, a collection as empty, the rest as their
// default values. Bylonder's bindings are in rna-bylonder.js. What the interface shows of a property (name, ranges,
// enum items, ...) is in rna-ui.json, loaded by loadRNAUI() before an editor first draws properties.
import structs from './rna-structs.json' with { type: 'json' };
import operators from './rna-operators.json' with { type: 'json' };
import * as bpyTypes from '../bl_ui/bpy.types.js';

// Transcrypt renames the Python names its runtime uses (type becomes py_metatype, others take a py_ prefix).
const rnaName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));

// A function's arguments as Python passes them, positional and then keywords: Transcrypt passes keywords as a last
// object marked __kwargtrans__, and renames the ones that are JS or runtime names (new as py_new).
export function pyArgs(list, names) {
  const last = list.at(-1), keywords = last && Object.hasOwn(last, '__kwargtrans__') ? last : {};
  const positional = keywords === last ? list.slice(0, -1) : list;
  return Object.fromEntries(names.map((name, i) => [name, keywords[name] ?? keywords['py_' + name] ?? positional[i]]));
}

function property(struct, name) {
  for (let s = structs[struct]; s; s = structs[s.base]) if (s.props[name]) return s.props[name];
  return null;
}

// `load` imports rna-ui.json: bundlers serve JSON as a module without Node's import attribute.
let ui = null;
export async function loadRNAUI(load = () => import('./rna-ui.json', { with: { type: 'json' } })) {
  ui ??= (await load()).default;
}

// A property as the interface shows it: { identifier, type (B, I, F, S, E, P, C), default, array (its length), struct
// (a pointer's or collection's), name, description, icon, subtype, unit, readonly, min, max, soft_min, soft_max, step,
// precision, items ([identifier, name, description, icon], null for a separator), flag }, or null if the struct lacks it.
export function rnaProperty(struct, name) {
  const [type, value] = property(struct, name) ?? [];
  if (!type) return operatorProperty(struct, name);
  let meta = {};
  for (let s = struct; s; s = structs[s]?.base) if (ui?.[s]?.props[name]) { meta = ui[s].props[name]; break; }
  return {
    identifier: name, type, ...meta, name: meta.name ?? name,
    ...(type === 'P' || type === 'C' ? { struct: value } : { default: value, array: Array.isArray(value) && type !== 'E' ? value.length : 0 }),
  };
}

// An operator's struct name (WM_operator_py_idname's inverse): view3d.select_box is VIEW3D_OT_select_box.
export const operatorStruct = (idname) => idname.replace(/^(\w+)\./, (match, group) => group.toUpperCase() + '_OT_');
export const operatorIdname = (struct) => struct.replace(/^(\w+?)_OT_/, (match, group) => group.toLowerCase() + '.');

// A property of an operator's struct (OperatorProperties: VIEW3D_OT_select_box), from rna-operators.json.
const OPERATOR_TYPES = { BOOLEAN: 'B', INT: 'I', FLOAT: 'F', STRING: 'S', ENUM: 'E', POINTER: 'P', COLLECTION: 'C' };
function operatorProperty(struct, name) {
  const p = /_OT_/.test(struct) && operators[operatorIdname(struct)]?.properties[name];
  if (!p) return null;
  const type = OPERATOR_TYPES[p.type], flag = type === 'E' && Array.isArray(p.default);
  return { ...p, identifier: name, type, flag, array: !flag && Array.isArray(p.default) ? p.default.length : 0, ...(p.fixed_type && { struct: p.fixed_type }) };
}

// A path from a struct (data_path), as RNA resolves it: names, ["name"] and [index].
function resolvePath(struct, path) {
  const parts = path.match(/[A-Za-z_]\w*|\[[^\]]+\]/g) ?? [];
  return parts.reduce((value, part) => {
    if (value == null) return value;
    if (!part.startsWith('[')) return value[part];
    const key = part.slice(1, -1);
    return /^\d+$/.test(key) ? value[+key] : (value.get?.(key.slice(1, -1)) ?? value[key.slice(1, -1)]);
  }, struct);
}
export const baseOf = (struct) => structs[struct]?.base ?? null;
export const structName = (struct) => ui?.[struct]?.name ?? struct;

const TYPES = { B: 'BOOLEAN', I: 'INT', F: 'FLOAT', S: 'STRING', E: 'ENUM', P: 'POINTER', C: 'COLLECTION' };
const blRnas = new Map();
const propertyNames = (struct) => { const names = new Set(); for (let s = structs[struct]; s; s = structs[s.base]) Object.keys(s.props).forEach((n) => names.add(n)); return names; };

// bpy_struct.bl_rna: a struct's RNA as Blender's scripts read it, its properties (its own and its bases') as
// rnaProperty() gives them, in Blender's words. Kept once the interface metadata is loaded.
export function blRna(struct) {
  if (blRnas.has(struct)) return blRnas.get(struct);
  const properties = [...propertyNames(struct)].map((identifier) => {
    const p = rnaProperty(struct, identifier), pointer = p.type === 'P' || p.type === 'C';
    return {
      identifier, name: p.name, description: p.description ?? '', type: TYPES[p.type], default: pointer ? null : p.default, is_readonly: !!p.readonly,
      subtype: p.subtype ?? 'NONE', unit: p.unit ?? 'NONE', icon: p.icon ?? 'NONE', array_length: p.array ?? 0, is_enum_flag: !!p.flag,
      hard_min: p.min, hard_max: p.max, soft_min: p.soft_min, soft_max: p.soft_max, step: p.step, precision: p.precision,
      enum_items: collection((p.items ?? []).filter(Boolean).map(([id, name, description, icon], value) => ({ identifier: id, name, description, icon, value }))),
      get enum_items_static() { return this.enum_items; },
      get fixed_type() { return pointer ? blRna(p.struct) : null; },
    };
  });
  const list = collection(properties);
  for (const p of properties) list[p.identifier] = p;
  const result = { identifier: struct, name: structName(struct), description: '', get base() { return structs[struct]?.base ? blRna(structs[struct].base) : null; }, properties: list };
  if (ui) blRnas.set(struct, result);
  return result;
}

// A collection property (bpy_prop_collection) of structs: iterable, with Blender's collection attributes.
// Transcrypt calls get and keys py_get and py_keys.
export function collection(items = [], active = null) {
  const get = (name, fallback = null) => items.find((item) => item.name === name) ?? fallback;
  const keys = () => items.map((item) => item.name), values = () => [...items], pairs = () => items.map((item) => [item.name, item]);
  return Object.assign([...items], {
    active, active_index: items.indexOf(active), get, py_get: get, keys, py_keys: keys, values, py_values: values, items: pairs, py_items: pairs,
    find: (name) => items.findIndex((item) => item.name === name),
  });
}

// What a struct proxy tells the interface about itself: its type, the properties Bylonder binds, the enum items its
// bindings give where Blender's depend on the data, the animation channels of its properties and its owner.
export const INFO = Symbol('rna');

// A struct of a type (Object, Scene, ...) holding `data`, a plain object of what Bylonder binds; getters in it are
// read each time and setters written through. Writing a property Bylonder does not bind keeps it on this struct only.
export function rna(struct, data = {}, { items = {}, channels = {}, owner = null } = {}) {
  const defaults = new Map(), info = { struct, bound: new Set(Object.keys(data)), items, channels, owner };
  return new Proxy(data, {
    get(target, key, receiver) {
      if (key === INFO) return info;
      // A struct is true in Python, whatever it holds (Transcrypt's truth test counts an object's keys).
      if (key === '__bool__') return () => true;
      // type(data) in the scripts (`type(context.curve) is TextCurve`): the struct's bpy.types class.
      if (key === '__class__') return bpyTypes[struct] ?? Object;
      if (typeof key !== 'string') return target[key];
      const name = rnaName(key);
      if (name in target) return target[name];
      if (key in target) return target[key];
      if (name === 'bl_rna') return blRna(struct);
      if (name === 'path_resolve') return (path) => resolvePath(receiver, path);
      if (name === 'id_data') return receiver;
      // ID properties (custom properties), which Bylonder's data has none of.
      if (['keys', 'values', 'items'].includes(name)) return () => [];
      if (name === 'is_property_set') return (property) => info.bound.has(property);
      if (name === 'rna_type') return blRna(struct);
      const prop = property(struct, name);
      // Context members outside Context's RNA (object, sculpt_object, ...) are None where the context lacks them.
      if (!prop) return struct === 'Context' ? null : undefined;
      if (!defaults.has(name)) {
        const [type, value, never_none] = prop;
        defaults.set(name, type === 'P' ? (never_none ? rna(value) : null) : type === 'C' ? collection() : Array.isArray(value) ? [...value] : value);
      }
      return defaults.get(name);
    },
    set: (target, key, value) => Reflect.set(target, typeof key === 'string' ? rnaName(key) : key, value),
    has: (target, key) => typeof key === 'string' && (key === '__class__' ? !!bpyTypes[struct] : rnaName(key) in target || !!property(struct, rnaName(key))),
  });
}
