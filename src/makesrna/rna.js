// Blender's data as its UI scripts read it (src/bl_ui): a struct is the data Bylonder binds, under Blender's property
// names, and every property it does not bind reads as Blender's default (rna-structs.json, from Blender itself): a
// pointer as None, or the struct's defaults when Blender's never is None, a collection as empty, the rest as their
// default values.
import structs from './rna-structs.json' with { type: 'json' };

// Transcrypt renames the Python names its runtime uses (type becomes py_metatype, others take a py_ prefix).
const rnaName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));

function property(struct, name) {
  for (let s = structs[struct]; s; s = structs[s.base]) if (s.props[name]) return s.props[name];
  return null;
}

// An empty collection: iterable, with Blender's collection attributes.
const collection = () => Object.assign([], { active: null, active_index: -1, get: () => null, find: () => -1 });

// A struct of a type (Object, Scene, ...) holding `data`, a plain object of what Bylonder binds; getters in it are
// read each time.
export function rna(struct, data = {}) {
  const defaults = new Map();
  return new Proxy(data, {
    get(target, key) {
      if (typeof key !== 'string') return target[key];
      const name = rnaName(key);
      if (name in target) return target[name];
      if (key in target) return target[key];
      if (name === 'bl_rna') return { identifier: struct };
      const prop = property(struct, name);
      if (!prop) return undefined;
      if (!defaults.has(name)) {
        const [type, value, never_none] = prop;
        defaults.set(name, type === 'P' ? (never_none ? rna(value) : null) : type === 'C' ? collection() : value);
      }
      return defaults.get(name);
    },
    has: (target, key) => typeof key === 'string' && (rnaName(key) in target || !!property(struct, rnaName(key))),
  });
}
