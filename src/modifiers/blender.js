// Blender's modifiers, evaluated by Blender's own code in the module. Settings are stored by RNA identifier
// (`count`, `use_axis[0]`) and described by Blender's RNA (rna-modifiers.json); they are written into each
// ModifierData at the DNA fields RNA names (dna-modifiers.json).
import rna from '../makesrna/rna-modifiers.json' with { type: 'json' };
import dna from '../makesrna/dna-modifiers.json' with { type: 'json' };
import { evaluateModifiers, drawModifierPanel, meshData, EditMesh, blenderModule } from '../bmesh/bmesh-wasm.js';
import { moduleTexture, freeUnusedTextures } from '../blenkernel/texture/texture.js';
import { createMesh } from '../blenkernel/mesh/mesh.js';
import { fieldLayout, writeValues, readValues } from './dna-write.js';

// The types that evaluate on a mesh alone; the rest need other objects, vertex groups, bind data or simulation.
const MESH_ONLY = ['ARRAY', 'BEVEL', 'BUILD', 'DECIMATE', 'EDGE_SPLIT', 'MIRROR', 'REMESH', 'SCREW', 'SKIN', 'SOLIDIFY', 'SUBSURF', 'TRIANGULATE',
  'WELD', 'WIREFRAME', 'CAST', 'DISPLACE', 'SIMPLE_DEFORM', 'SMOOTH', 'CORRECTIVE_SMOOTH', 'LAPLACIANSMOOTH', 'WAVE', 'WEIGHTED_NORMAL'];
const UNITS = { LENGTH: 'length', ROTATION: 'angle' };
// Enum items Bylonder does not offer yet, by type and property.
const NOT_OFFERED = { REMESH: { mode: ['BLOCKS', 'SMOOTH', 'SHARP'] } };
const AXES = ['TRANSLATION', 'XYZ', 'COORDINATES', 'DIRECTION'];
const editable = (prop) => ['BOOLEAN', 'INT', 'FLOAT', 'ENUM'].includes(prop.type) && !prop.hidden && !Array.isArray(prop.default?.[0]) &&
  !(prop.type === 'ENUM' && Array.isArray(prop.default));

// The schema entry (Bylonder's field description) of an RNA property, or of one element of an RNA array.
function field(prop, value, label = prop.name, hidden = []) {
  const entry = { label, default: value, description: prop.description };
  if (prop.type === 'ENUM') entry.options = Object.fromEntries(prop.items.filter(([id]) => !hidden.includes(id)).map(([id, name]) => [name, id]));
  if (prop.type === 'INT' || prop.type === 'FLOAT') {
    Object.assign(entry, { min: prop.min, max: prop.max, softMin: prop.soft_min, softMax: prop.soft_max });
    if (prop.type === 'INT') Object.assign(entry, { step: 1, integer: true });
    // RNA's float step is in hundredths of a unit.
    else Object.assign(entry, { step: prop.step / 100, precision: prop.precision, ...(UNITS[prop.unit] && { unit: UNITS[prop.unit] }) });
  }
  return entry;
}

// RNA properties as schema paths: a property by its identifier, an array element as Python indexes it.
function schema(properties, located, hidden = {}) {
  return Object.fromEntries(Object.entries(properties).filter(([id, prop]) => located[id] && editable(prop)).flatMap(([id, prop]) =>
    Array.isArray(prop.default)
      ? prop.default.map((value, i) => [`${id}[${i}]`, field(prop, value, `${prop.name} ${AXES.includes(prop.subtype) || prop.size === 3 ? 'XYZ'[i] : i}`)])
      : [[id, field(prop, prop.default, prop.name, hidden[id])]]));
}

function definition(id) {
  const { value: type, name, description, icon, struct, properties } = rna.types[id];
  const located = dna[struct].properties;
  // A Texture pointer (MappingInfoModifierData's), stored as the texture's id (textures.js).
  const textured = properties.texture?.fixed_type === 'Texture';
  const fields = { ...schema(properties, located, NOT_OFFERED[id]), ...(textured && { texture: { label: 'Texture', default: null, id: 'Texture', animatable: false } }) };
  // The DNA layouts of the properties a stack entry's settings name, which is all writing them needs.
  const layouts = (values) => Object.fromEntries(Object.keys(values).map((path) => path.match(/^\w+/)[0])
    .filter((prop) => located[prop] && properties[prop] && located[prop].kind !== 'pointer').map((prop) => [prop, fieldLayout(located[prop], properties[prop])]));
  const write = (values) => (view, address) => writeValues(view, address, layouts(values), values);
  // The settings a ModifierData of this type holds (one Main read from a file).
  const read = (view, address) => readValues(view, address, layouts(fields), Object.keys(fields));
  return {
    id, name, description, icon, category: 'Generate', blender: `object.modifier_add:${id}`,
    schema: fields,
    defaults: () => Object.fromEntries(Object.entries(fields).map(([path, entry]) => [path, entry.default])),
    mesh: { type, write, read, layouts, textured },
  };
}

export const blenderModifierDefinitions = MESH_ONLY.map(definition);
// Any Blender modifier type's definition, for stacks Bylonder evaluates itself (curve and text objects).
export const blenderModifierDefinition = definition;
// A modifier's pointer properties (CurveModifier.object) at their DNA offsets.
export const modifierPointers = (id) => Object.fromEntries(Object.entries(dna[rna.types[id].struct].properties)
  .filter(([, field]) => field.kind === 'pointer').map(([name, { offset }]) => [name, offset]));

// A stack entry as one of Blender's modifiers: Blender's own as it is, Bylonder's Geometry Nodes Array as Blender's
// Array where its settings are the Array modifier's (a line of copies, without rotation, scale or randomness); null
// when Blender has none like it.
export function asBlenderModifier(modifier) {
  if (blenderModifierDefinitions.some((d) => d.id === modifier.type)) return modifier;
  const v = modifier.values;
  const line = modifier.type === 'GN_ARRAY' && v.shape === 'Line' && v.countMethod === 'Count' && !v.randomize &&
    ['x', 'y', 'z'].every((axis) => v[`rotation.${axis}`] === 0 && v[`scale.${axis}`] === 1);
  if (!line) return null;
  const relative = v.offsetMethod === 'Relative', step = v.offsetMethod === 'Endpoint' ? 1 / Math.max(1, v.count - 1) : 1;
  const offset = relative ? 'offset' : 'translation', key = relative ? 'relative_offset_displace' : 'constant_offset_displace';
  // Babylon's (x, y, z) is Blender's (x, z, y).
  const values = { count: v.count, use_relative_offset: relative, use_constant_offset: !relative, use_merge_vertices: v.merge, merge_threshold: v.mergeDistance,
    ...Object.fromEntries(['x', 'z', 'y'].map((axis, i) => [`${key}[${i}]`, v[`${offset}.${axis}`] * (relative ? 1 : step)])) };
  return { ...modifier, type: 'ARRAY', values };
}

// Stack entries ({type, values, texture}: a textured modifier's texture settings) as the module takes them; `texture`
// gives the Tex a modifier points at, by default one outside Main with the entry's settings.
const entryTexture = (entry) => (entry.texture ? moduleTexture(entry.texture) : 0);
export const moduleModifiers = (modifiers, texture = entryTexture) => modifiers.map((entry) => {
  const { mesh: { type: value, write, textured } } = blenderModifierDefinitions.find((d) => d.id === entry.type);
  const tex = textured ? texture(entry) : 0;
  return { type: value, write: (view, md) => { write(entry.values)(view, md); if (textured) blenderModule.exports.modifier_texture_set(md, tex); } };
});
// Runs fn on the module's evaluation of a stack, then frees the textures no modifier uses any more.
const withTextures = (fn) => { try { return fn(); } finally { freeUnusedTextures(); } };

// An error a modifier reported, as against the module failing (a trap, or running out of memory).
export class ModifierError extends Error {
  name = 'ModifierError';
}

// The evaluated Mesh of an evaluation ({mesh, errors}); throws the first modifier's error, as Blender shows it in its
// panel.
export function evaluated({ mesh, errors }) {
  const error = errors.find(Boolean);
  if (error) throw new ModifierError(error);
  return mesh;
}

// Evaluates Blender modifiers on a Mesh.
export const evaluateBlenderModifiers = (mesh, modifiers) => withTextures(() => evaluated(evaluateModifiers(mesh, moduleModifiers(modifiers))));

// An evaluation that can be posted to another realm: a Mesh's data, stack entries, and for Edit Mode the select mode
// of the edit mesh the Mesh was extracted from.
export const evaluation = (mesh, modifiers, selectmode) =>
  ({ mesh: meshData(mesh), modifiers: modifiers.map(({ type, values, texture }) => ({ type, values, texture })), selectmode });

// Runs an evaluation in this realm's module: the evaluated Mesh detached from it.
export const evaluate = ({ mesh, modifiers, selectmode }) => withTextures(() => {
  const input = createMesh(mesh), stack = moduleModifiers(modifiers);
  if (selectmode === undefined) return evaluated(evaluateModifiers(input, stack)).detach();
  const edit = EditMesh.fromMesh(input, selectmode);
  try {
    return evaluated(edit.evaluate(stack)).detach();
  } finally {
    edit.free();
  }
});

// How many times the faces it takes a modifier makes, where its settings say so up front.
const GROWTH = {
  SUBSURF: (v) => 4 ** v.levels,
  ARRAY: (v) => (v.fit_type === 'FIXED_COUNT' ? v.count : 1),
  SCREW: (v) => v.steps * v.iterations,
  BEVEL: (v) => v.segments,
};
// About how many faces a stack makes of a Mesh, for asking before an evaluation that would take very long.
export const estimatedFaces = (mesh, modifiers) =>
  modifiers.reduce((faces, { type, values }) => faces * (GROWTH[type]?.(values) ?? 1), mesh.faces_num || mesh.edges_num);

// What Blender's panel for a stack entry draws with its values (drawModifierPanel), its texture Main's (`texture(id)`).
export const modifierPanel = (modifier, texture = () => 0) => drawModifierPanel(moduleModifiers([modifier], (entry) => texture(entry.values.texture))[0]);
