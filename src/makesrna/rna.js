// Blender's data as its UI scripts read it (src/bl_ui): a struct is the data Bylonder binds, under Blender's property
// names, and every property it does not bind reads as Blender's default (rna-structs.json, from Blender itself): a
// pointer as None, or the struct's defaults when Blender's never is None, a collection as empty, the rest as their
// default values. Bylonder's bindings are in rna-bylonder.js. What the interface shows of a property (name, ranges,
// enum items, ...) is in rna-ui.json, loaded by loadRNAUI() before an editor first draws properties.
import structs from './rna-structs.json' with { type: 'json' };

// Transcrypt renames the Python names its runtime uses (type becomes py_metatype, others take a py_ prefix).
const rnaName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));

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
  if (!type) return null;
  let meta = {};
  for (let s = struct; s; s = structs[s]?.base) if (ui?.[s]?.props[name]) { meta = ui[s].props[name]; break; }
  return {
    identifier: name, type, ...meta, name: meta.name ?? name,
    ...(type === 'P' || type === 'C' ? { struct: value } : { default: value, array: Array.isArray(value) && type !== 'E' ? value.length : 0 }),
  };
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
      if (typeof key !== 'string') return target[key];
      const name = rnaName(key);
      if (name in target) return target[name];
      if (key in target) return target[key];
      if (name === 'bl_rna') return { identifier: struct, name: structName(struct) };
      if (name === 'path_resolve') return (path) => resolvePath(receiver, path);
      if (name === 'id_data') return receiver;
      // ID properties (custom properties), which Bylonder's data has none of.
      if (['keys', 'values', 'items'].includes(name)) return () => [];
      if (name === 'is_property_set') return (property) => info.bound.has(property);
      if (name === 'rna_type') return { identifier: struct, name: structName(struct), properties: collection() };
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
    has: (target, key) => typeof key === 'string' && (rnaName(key) in target || !!property(struct, rnaName(key))),
  });
}
