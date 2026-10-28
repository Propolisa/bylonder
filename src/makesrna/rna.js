// Blender's data as its UI scripts read it (src/bl_ui): a struct is the data Bylonder binds, under Blender's property
// names, and every property it does not bind reads as Blender's default (rna-structs.json, from Blender itself): a
// pointer as None, or the struct's defaults when Blender's never is None, a collection as empty, the rest as their
// default values. Bylonder's bindings are in rna-bylonder.js.
import structs from './rna-structs.json' with { type: 'json' };

// Transcrypt renames the Python names its runtime uses (type becomes py_metatype, others take a py_ prefix).
const rnaName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));

// A function's arguments as Python passes them, positional and then keywords: Transcrypt passes keywords as a last
// object marked __kwargtrans__.
export function pyArgs(list, names) {
  const last = list.at(-1), keywords = last && Object.hasOwn(last, '__kwargtrans__') ? last : {};
  const positional = keywords === last ? list.slice(0, -1) : list;
  return Object.fromEntries(names.map((name, i) => [name, keywords[name] ?? positional[i]]));
}

function property(struct, name) {
  for (let s = structs[struct]; s; s = structs[s.base]) if (s.props[name]) return s.props[name];
  return null;
}

// A collection property (bpy_prop_collection) of structs: iterable, with Blender's collection attributes.
export const collection = (items = [], active = null) => Object.assign([...items], {
  active,
  active_index: items.indexOf(active),
  get: (name, fallback = null) => items.find((item) => item.name === name) ?? fallback,
  find: (name) => items.findIndex((item) => item.name === name),
});

const TYPES = { B: 'BOOLEAN', I: 'INT', F: 'FLOAT', S: 'STRING', E: 'ENUM', P: 'POINTER', C: 'COLLECTION' };
const blRnas = new Map();

// bpy_struct.bl_rna: a struct's RNA, its properties with their types and defaults, its own and its bases'.
export function blRna(struct) {
  if (!blRnas.has(struct)) {
    const properties = [];
    for (let s = structs[struct]; s; s = structs[s.base]) {
      for (const [identifier, [type, value]] of Object.entries(s.props)) {
        if (properties.some((p) => p.identifier === identifier)) continue;
        const pointer = type === 'P' || type === 'C';
        properties.push({ identifier, name: identifier, description: '', type: TYPES[type], default: pointer ? null : value, is_readonly: false, enum_items: collection(),
          get fixed_type() { return pointer ? blRna(value) : null; } });
      }
    }
    const list = collection(properties);
    for (const p of properties) list[p.identifier] = p;
    blRnas.set(struct, { identifier: struct, name: struct, description: '', base: structs[struct]?.base ? blRna(structs[struct].base) : null, properties: list });
  }
  return blRnas.get(struct);
}

// A struct of a type (Object, Scene, ...) holding `data`, a plain object of what Bylonder binds; getters in it are
// read each time and setters written through. Writing a property Bylonder does not bind keeps it on this struct only.
export function rna(struct, data = {}) {
  const defaults = new Map();
  return new Proxy(data, {
    get(target, key) {
      if (typeof key !== 'string') return target[key];
      const name = rnaName(key);
      if (name in target) return target[name];
      if (key in target) return target[key];
      if (name === 'bl_rna') return blRna(struct);
      const prop = property(struct, name);
      // Context members outside Context's RNA (object, sculpt_object, ...) are None where the context lacks them.
      if (!prop) return struct === 'Context' ? null : undefined;
      if (!defaults.has(name)) {
        const [type, value, never_none] = prop;
        defaults.set(name, type === 'P' ? (never_none ? rna(value) : null) : type === 'C' ? collection() : value);
      }
      return defaults.get(name);
    },
    set: (target, key, value) => Reflect.set(target, typeof key === 'string' ? rnaName(key) : key, value),
    has: (target, key) => typeof key === 'string' && (rnaName(key) in target || !!property(struct, rnaName(key))),
  });
}
