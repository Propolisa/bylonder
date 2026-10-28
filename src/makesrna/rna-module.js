// A struct in the module's memory as Blender's RNA reads and writes it there (operator-properties.cc's rna_get, rna_set:
// its DNA fields, set functions and updates), by the pointer a recorded layout gives a property (panel-layout.cc: struct
// type, owner ID, data), for buttons drawn from Blender's C panels. Enums go by identifier through the DNA tables' items
// (modifier_dna.py).
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { rna } from './rna.js';
import structs from './rna-structs.json' with { type: 'json' };
import fcurve from './dna-fcurve.json' with { type: 'json' };

const { exports: x, withString, cString } = blenderModule;
const TABLES = { ...fcurve };
// The structs the module's RNA reads and writes.
export const moduleStructs = new Set(Object.keys(TABLES));

function enumItems(struct, name) {
  for (let s = struct; s; s = structs[s]?.base) {
    const items = TABLES[s]?.properties[name]?.items;
    if (items) return items;
  }
  return [];
}

// The struct `struct` at [type, id, data]; a set runs in `C` (for the property's update), then `changed()`.
export function moduleStruct(struct, [type, id, data], { C, changed = () => {} }) {
  const at = (name, fn) => withString(name, (p) => fn(p));
  const number = (name, index) => at(name, (p) => x.rna_get(type, id, data, p, index));
  const setNumber = (name, index, value) => at(name, (p) => x.rna_set(C, type, id, data, p, index, value));
  const bindings = {};
  for (const [name, [kind, fallback]] of Object.entries(structs[struct]?.props ?? {})) {
    if (kind === 'P' || kind === 'C') continue;
    const items = kind === 'E' ? enumItems(struct, name) : null;
    const array = Array.isArray(fallback) && kind !== 'E';
    const scalar = (v) => (kind === 'B' ? !!v : items ? (items.find(([value]) => value === v)?.[1] ?? '') : v);
    const raw = (v) => (items ? (items.find(([, identifier]) => identifier === v)?.[0] ?? 0) : Number(v));
    const get = kind === 'S' ? () => at(name, (p) => cString(x.rna_string_get(type, id, data, p)))
      : array ? () => Array.from({ length: Math.max(0, at(name, (p) => x.rna_length(type, id, data, p))) }, (_, i) => scalar(number(name, i)))
        : () => scalar(number(name, 0));
    const set = (value) => {
      if (kind === 'S') at(name, (p) => withString(String(value), (v) => x.rna_string_set(C, type, id, data, p, v)));
      else if (array) get().forEach((old, i) => { if (value[i] !== undefined && value[i] !== old) setNumber(name, i, raw(value[i])); });
      else setNumber(name, 0, raw(value));
      changed();
    };
    bindings[name] = { get, set, enumerable: true };
  }
  return rna(struct, Object.defineProperties({}, bindings));
}
