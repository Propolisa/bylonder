// A DNA struct in the module's memory, by the RNA properties dna-outliner.json and dna-data.json describe
// (tools/blender-port/modifier_dna.py): booleans (a bit, maybe negative), numbers and number arrays, enums by
// identifier and strings, read and written in place as Blender's RNA reads and writes them. A struct has its RNA
// base's properties too (PointLight has Light's).
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { baseOf } from './rna.js';
import outliner from './dna-outliner.json' with { type: 'json' };
import data from './dna-data.json' with { type: 'json' };

const { exports: x } = blenderModule;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const view = () => new DataView(x.memory.buffer);
const tables = { ...outliner, ...data };

const properties = new Map();
// A struct's properties with its bases', by RNA identifier.
export function dnaProperties(struct) {
  if (!properties.has(struct)) {
    const base = baseOf(struct);
    properties.set(struct, { ...(base ? dnaProperties(base) : {}), ...tables[struct]?.properties });
  }
  return properties.get(struct);
}
// The property's field, or undefined when its DNA is not described.
export const dnaProperty = (struct, name) => dnaProperties(struct)[name];
// Whether a field holds text: a string, or an enum Blender stores by its identifier (the render engine).
export const dnaIsText = (prop) => prop.type === 'STRING' || (prop.type === 'ENUM' && prop.size === 1 && prop.length > 1);

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

function readValue(dv, at, prop) {
  if (prop.kind === 'float') return dv.getFloat32(at, true);
  const word = readInt(dv, at, prop);
  if (prop.type === 'BOOLEAN') return (prop.bit ? (word & prop.bit) !== 0 : word !== 0) !== !!prop.negative;
  // Enums of signed C types (int8_t color tags) read as their signed values.
  const value = prop.type === 'ENUM' && prop.items?.some(([v]) => v < 0) ? (word << (32 - 8 * prop.size)) >> (32 - 8 * prop.size) : word;
  return prop.type === 'ENUM' ? (prop.items?.find(([v]) => v === value)?.[1] ?? value) : value;
}
function writeValue(dv, at, prop, value) {
  if (prop.kind === 'float') dv.setFloat32(at, value, true);
  else if (prop.type === 'BOOLEAN') {
    const word = readInt(dv, at, prop), on = !!value !== !!prop.negative;
    writeInt(dv, at, prop, prop.bit ? (on ? word | prop.bit : word & ~prop.bit) : Number(on));
  } else writeInt(dv, at, prop, prop.type === 'ENUM' && typeof value === 'string' ? prop.items.find(([, id]) => id === value)[0] : value);
}

// The property's value in the struct at `pointer` (an array for an array property).
export function dnaGet(struct, pointer, name) {
  const prop = dnaProperty(struct, name), dv = view(), at = pointer + prop.offset;
  if (dnaIsText(prop)) {
    const bytes = new Uint8Array(x.memory.buffer, at, prop.length ?? prop.size);
    return decoder.decode(bytes.subarray(0, Math.max(0, bytes.indexOf(0))));
  }
  if (prop.length) return Array.from({ length: prop.length }, (_, i) => readValue(dv, at + i * prop.size, prop));
  return readValue(dv, at, prop);
}

export function dnaSet(struct, pointer, name, value) {
  const prop = dnaProperty(struct, name), dv = view(), at = pointer + prop.offset;
  if (dnaIsText(prop)) {
    const bytes = new Uint8Array(x.memory.buffer, at, prop.length ?? prop.size);
    bytes.fill(0);
    bytes.set(encoder.encode(String(value)).subarray(0, bytes.length - 1));
  } else if (prop.length) Array.from(value).slice(0, prop.length).forEach((v, i) => writeValue(dv, at + i * prop.size, prop, v));
  else writeValue(dv, at, prop, value);
}

// The struct at `pointer` as an object of its properties.
export const dnaStruct = (struct, pointer) => Object.defineProperties({}, Object.fromEntries(Object.keys(dnaProperties(struct)).map((name) => [name, {
  enumerable: true, get: () => dnaGet(struct, pointer, name), set: (value) => dnaSet(struct, pointer, name, value),
}])));

// An enum property's items as [value, identifier] pairs.
export const dnaEnumItems = (struct, name) => dnaProperty(struct, name).items ?? [];
