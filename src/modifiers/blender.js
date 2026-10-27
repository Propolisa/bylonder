// Blender's modifiers, evaluated by Blender's own code in the module. Settings are stored by RNA identifier
// (`count`, `use_axis[0]`) and described by Blender's RNA (rna-modifiers.json); they are written into each
// ModifierData at the DNA fields RNA names (dna-modifiers.json).
import rna from '../makesrna/rna-modifiers.json' with { type: 'json' };
import dna from '../makesrna/dna-modifiers.json' with { type: 'json' };
import { evaluateModifiers } from '../bmesh/bmesh-wasm.js';

// The types that evaluate on a mesh alone; the rest need other objects, vertex groups, bind data or simulation.
const MESH_ONLY = ['ARRAY', 'BEVEL', 'BUILD', 'DECIMATE', 'EDGE_SPLIT', 'MIRROR', 'REMESH', 'SCREW', 'SKIN', 'SOLIDIFY', 'SUBSURF', 'TRIANGULATE',
  'WELD', 'WIREFRAME', 'CAST', 'DISPLACE', 'SIMPLE_DEFORM', 'SMOOTH', 'CORRECTIVE_SMOOTH', 'LAPLACIANSMOOTH', 'WAVE', 'WEIGHTED_NORMAL'];
const UNITS = { LENGTH: 'length', ROTATION: 'angle' };
const AXES = ['TRANSLATION', 'XYZ', 'COORDINATES', 'DIRECTION'];
const editable = (prop) => ['BOOLEAN', 'INT', 'FLOAT', 'ENUM'].includes(prop.type) && !prop.hidden && !Array.isArray(prop.default?.[0]) &&
  !(prop.type === 'ENUM' && Array.isArray(prop.default));

// The schema entry (Bylonder's field description) of an RNA property, or of one element of an RNA array.
function field(prop, value, label = prop.name) {
  const entry = { label, default: value, description: prop.description };
  if (prop.type === 'ENUM') entry.options = Object.fromEntries(prop.items.map(([id, name]) => [name, id]));
  if (prop.type === 'INT' || prop.type === 'FLOAT') {
    Object.assign(entry, { min: prop.min, max: prop.max, softMin: prop.soft_min, softMax: prop.soft_max });
    if (prop.type === 'INT') Object.assign(entry, { step: 1, integer: true });
    // RNA's float step is in hundredths of a unit.
    else Object.assign(entry, { step: prop.step / 100, precision: prop.precision, ...(UNITS[prop.unit] && { unit: UNITS[prop.unit] }) });
  }
  return entry;
}

// RNA properties as schema paths: a property by its identifier, an array element as Python indexes it.
function schema(properties, located) {
  return Object.fromEntries(Object.entries(properties).filter(([id, prop]) => located[id] && editable(prop)).flatMap(([id, prop]) =>
    Array.isArray(prop.default)
      ? prop.default.map((value, i) => [`${id}[${i}]`, field(prop, value, `${prop.name} ${AXES.includes(prop.subtype) || prop.size === 3 ? 'XYZ'[i] : i}`)])
      : [[id, field(prop, prop.default)]]));
}

// Writes a value into the DNA field (dna-modifiers.json) at a struct's address: a bit of a flag field, an element of an
// array, an enum by its item's value, or a number.
function writeField(view, address, located, prop, value, index = 0) {
  const { offset, size, kind, signed, bit, bitset, negative } = located;
  const at = address + offset + (bitset ? 0 : index * size);
  const get = { 1: signed ? 'Int8' : 'Uint8', 2: signed ? 'Int16' : 'Uint16', 4: signed ? 'Int32' : 'Uint32' }[size];
  if (kind === 'float') return view.setFloat32(at, value, true);
  if (bit !== undefined && prop.type === 'BOOLEAN') {
    const mask = bitset ? bit << index : bit, on = negative ? !value : value;
    const word = view[`get${get}`](at, true);
    return view[`set${get}`](at, on ? word | mask : word & ~mask, true);
  }
  const number = prop.type === 'ENUM' ? prop.items.find(([id]) => id === value)[3] : Number(value);
  view[`set${get}`](at, number, true);
}

function definition(id) {
  const { value: type, name, description, icon, struct, properties } = rna.types[id];
  const located = dna[struct].properties;
  const fields = schema(properties, located);
  const write = (values) => (view, address) => {
    for (const [path, value] of Object.entries(values)) {
      const [, prop, index] = path.match(/^(\w+)(?:\[(\d+)\])?$/);
      if (located[prop] && properties[prop]) writeField(view, address, located[prop], properties[prop], value, Number(index ?? 0));
    }
  };
  return {
    schema: fields,
    defaults: () => Object.fromEntries(Object.entries(fields).map(([path, entry]) => [path, entry.default])),
    mesh: { type, write },
  };
}

export const blenderModifierDefinitions = MESH_ONLY.map(definition);

// Evaluates Blender modifiers on a Mesh; throws the first modifier's error, as Blender shows it in its panel.
export function evaluateBlenderModifiers(mesh, modifiers) {
  const { mesh: result, errors } = evaluateModifiers(mesh, modifiers.map(({ type, values }) => {
    const { mesh: { type: value, write } } = blenderModifierDefinitions.find((d) => d.id === type);
    return { type: value, write: write(values) };
  }));
  const error = errors.find(Boolean);
  if (error) throw new Error(error);
  return result;
}
