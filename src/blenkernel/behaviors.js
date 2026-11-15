// An object's behaviours as Blender data (docs/notes/game-code.md): a custom property group `behaviors` holding one
// group per behaviour, its props as members, in the order the behaviours were added. Numbers, checkboxes, names and
// colours are values; an object, action, sound or collection is an ID pointer, which counts as a user of that ID and
// follows its renames. Written through Blender's own IDP_* (main-api.cc id_property_*), read through RNA.
import { blenderModule, ID_RECALC_SYNC_TO_EVAL } from '../bmesh/bmesh-wasm.js';
import { enumValue } from '../io_scene_babylon/runtime/game/define.js';
import { PROPERTY_SUBTYPES, PROPERTY_TYPES } from './animation/anim-blender.js';
import { blendData, customPropertySubtype, pointerOf } from '../python/bpy_rna.js';

const { exports: x, withArrays, withString } = blenderModule;
export const BEHAVIORS = 'behaviors';
// Each ID prop type's bpy.data collection.
const ID_PROPS = { object: 'objects', action: 'actions', sound: 'sounds', collection: 'collections' };

const idOf = (struct) => pointerOf(struct)?.[1] ?? 0;
// A name as Blender's UI shows one: words, capitalised.
export const label = (name) => name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const strings = (values, fn) => values.reduceRight((inner, value) => (...pointers) => withString(value, (p) => inner(...pointers, p)), fn)();

// What a write changed reaches the depsgraph, as an edit through RNA does: the run takes it on the next frame.
const touched = (ob, done) => { x.id_tag_update(idOf(ob), ID_RECALC_SYNC_TO_EVAL); return done; };

/** Sets one prop of a behaviour on an object (an Object struct) to `value`, as its schema types it. */
export const setBehaviorProp = (ob, behavior, name, schema, value) => touched(ob, writeProp(ob, behavior, name, schema, value));
function writeProp(ob, behavior, name, schema, value) {
  const id = idOf(ob), path = `${BEHAVIORS}/${behavior}`;
  if (schema.type in ID_PROPS) {
    const target = (name) => blendData()[ID_PROPS[schema.type]]?.get(name) ?? null;
    // Several (a sound to pick from): a group of ID pointers by their place.
    if (Array.isArray(value)) return value.map((each, i) => strings([`${path}/${name}`, String(i)], (p, n) => x.id_property_id_set(id, p, n, idOf(target(each))))).every(Boolean);
    return strings([path, name], (p, n) => x.id_property_id_set(id, p, n, value ? idOf(target(value)) : 0));
  }
  // An enum is Blender's enum ID property: each option's value its own (enumValue), so the options can be reordered.
  if (schema.type === 'enum') {
    const items = schema.options.map((option) => [option, label(option), enumValue(option)].join('\t')).join('\n');
    return strings([path, name, items, schema.description ?? ''], (p, n, i, d) => x.id_property_member_enum_set(id, p, n, i, typeof value === 'number' ? value : enumValue(value), d));
  }
  if (schema.type === 'knot' || typeof value === 'string') return strings([path, name, String(value)], (p, n, v) => x.id_property_member_string_set(id, p, n, v));
  const values = [value].flat().map(Number), length = Array.isArray(value) ? values.length : 0;
  const type = schema.type === 'bool' ? 'BOOLEAN' : schema.type === 'int' ? 'INT' : 'FLOAT';
  const subtype = PROPERTY_SUBTYPES.get(schema.type === 'color' ? 'COLOR' : 'NONE') ?? 0;
  // Limits apply where min < max: a side the schema leaves open is the type's whole range.
  const limited = schema.min !== undefined || schema.max !== undefined, whole = type === 'INT' ? 2147483647 : 3.4e38;
  const [min, max] = limited ? [schema.min ?? -whole, schema.max ?? whole] : [0, 0];
  return withArrays([Float64Array.from(values)], ([v]) => strings([path, name, schema.description ?? ''], (p, n, d) =>
    x.id_property_member_set(id, p, n, PROPERTY_TYPES[type], v, length, subtype, min, max, d)));
}

/** Adds a behaviour (its definition) to an object with its props' defaults; nothing when it has it already. */
export function addBehavior(ob, definition) {
  if (behaviorNames(ob).includes(definition.name)) return false;
  strings([`${BEHAVIORS}/${definition.name}`], (p) => x.id_property_group_ensure(idOf(ob), p));
  for (const [name, schema] of Object.entries(definition.props ?? {})) writeProp(ob, definition.name, name, schema, schema.default);
  return touched(ob, true);
}

/** Removes a behaviour, with its props, from an object. */
export function removeBehavior(ob, name) {
  return touched(ob, !!strings([BEHAVIORS, name], (p, n) => x.id_property_member_remove(idOf(ob), p, n)));
}

/**
 * An object's behaviour made to match its code, as a project opens or its code changes: props the code added get their
 * defaults, and props of a kind the .blend does not hold as the code declares (a colour without its colour subtype,
 * an enum kept as its name, as a script writes them) are written again with their values. Nothing else is touched.
 * Gives whether it changed anything.
 */
export function repairBehavior(ob, definition) {
  const group = ob.get?.(BEHAVIORS)?.get?.(definition.name);
  if (!group?.keys) return false;
  const held = new Set(group.keys()), COLOR = PROPERTY_SUBTYPES.get('COLOR');
  const repaired = Object.entries(definition.props ?? {}).filter(([name, schema]) => !held.has(name)
    || (schema.type === 'color' && customPropertySubtype(group, name) !== COLOR)
    || (schema.type === 'enum' && typeof group.get(name) === 'string'));
  for (const [name, schema] of repaired) writeProp(ob, definition.name, name, schema, held.has(name) ? group.get(name) : schema.default);
  return repaired.length ? touched(ob, true) : false;
}

/** The behaviours an object carries, by name, in their order. */
export function behaviorNames(ob) {
  const group = ob.get?.(BEHAVIORS);
  return group?.keys ? [...group.keys()] : [];
}

/** Every object's behaviours made to match their code (repairBehavior): `definitions` by name. Gives whether any changed. */
export function repairBehaviors(definitions) {
  let changed = false;
  for (const ob of blendData().objects) for (const name of behaviorNames(ob)) if (definitions.has(name) && repairBehavior(ob, definitions.get(name))) changed = true;
  return changed;
}
