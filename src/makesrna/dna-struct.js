// A DNA struct in the module's memory, by the RNA properties dna-outliner.json describes (tools/blender-port/
// modifier_dna.py): booleans (a bit, maybe negative), numbers, enums by identifier and strings, read and written in
// place as Blender's RNA reads and writes them.
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import structs from './dna-outliner.json' with { type: 'json' };

const { exports: x } = blenderModule;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const view = () => new DataView(x.memory.buffer);

function readInt(dv, at, { size, signed }) {
  if (size === 1) return signed ? dv.getInt8(at) : dv.getUint8(at);
  if (size === 2) return signed ? dv.getInt16(at, true) : dv.getUint16(at, true);
  return signed ? dv.getInt32(at, true) : dv.getUint32(at, true);
}
function writeInt(dv, at, { size }, value) {
  if (size === 1) dv.setUint8(at, value & 0xff);
  else if (size === 2) dv.setUint16(at, value & 0xffff, true);
  else dv.setUint32(at, value >>> 0, true);
}

// The property's value in the struct at `pointer`.
export function dnaGet(struct, pointer, name) {
  const prop = structs[struct].properties[name], dv = view(), at = pointer + prop.offset;
  if (prop.type === 'STRING') {
    const bytes = new Uint8Array(x.memory.buffer, at, prop.length ?? prop.size);
    return decoder.decode(bytes.subarray(0, Math.max(0, bytes.indexOf(0))));
  }
  if (prop.kind === 'float') return dv.getFloat32(at, true);
  const word = readInt(dv, at, prop);
  if (prop.type === 'BOOLEAN') return (prop.bit ? (word & prop.bit) !== 0 : word !== 0) !== !!prop.negative;
  // Enums of signed C types (int8_t color tags) read as their signed values.
  const value = prop.type === 'ENUM' && prop.items?.some(([v]) => v < 0) ? (word << (32 - 8 * prop.size)) >> (32 - 8 * prop.size) : word;
  return prop.type === 'ENUM' ? (prop.items?.find(([v]) => v === value)?.[1] ?? value) : value;
}

export function dnaSet(struct, pointer, name, value) {
  const prop = structs[struct].properties[name], dv = view(), at = pointer + prop.offset;
  if (prop.type === 'STRING') {
    const bytes = new Uint8Array(x.memory.buffer, at, prop.length ?? prop.size);
    bytes.fill(0);
    bytes.set(encoder.encode(String(value)).subarray(0, bytes.length - 1));
  } else if (prop.kind === 'float') dv.setFloat32(at, value, true);
  else if (prop.type === 'BOOLEAN') {
    const word = readInt(dv, at, prop), on = !!value !== !!prop.negative;
    writeInt(dv, at, prop, prop.bit ? (on ? word | prop.bit : word & ~prop.bit) : Number(on));
  } else writeInt(dv, at, prop, prop.type === 'ENUM' && typeof value === 'string' ? prop.items.find(([, id]) => id === value)[0] : value);
}

// The struct at `pointer` as an object of its properties.
export const dnaStruct = (struct, pointer) => Object.defineProperties({}, Object.fromEntries(Object.keys(structs[struct].properties).map((name) => [name, {
  enumerable: true, get: () => dnaGet(struct, pointer, name), set: (value) => dnaSet(struct, pointer, name, value),
}])));

// The struct's properties as rna-bylonder.js binds them, over the struct at `pointer`.
export const dnaBindings = (struct, pointer) => Object.fromEntries(Object.keys(structs[struct].properties).map((name) => [name, {
  get: () => dnaGet(struct, pointer, name), set: (owner, value) => dnaSet(struct, pointer, name, value),
}]));

// An enum property's items as [value, identifier] pairs.
export const dnaEnumItems = (struct, name) => structs[struct].properties[name].items ?? [];
