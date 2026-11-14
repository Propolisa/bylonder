// An export of what changed alone (docs/data-flow.md, Dependency closure): the datablocks Blender's depsgraph updated
// since the last export (an edit's, and what reads it: constraint targets, drivers, modifiers, parents), the objects
// that use them, and their entries in the last export's tables replaced by a Selected Objects export of those objects.
// What belongs to the scene as a whole (the scene, its world, the compositor) exports the whole scene again.
import { exportPackage } from './js-export.js';
import { packageState } from './scene-patch.js';
import { idKey } from './ir-export.js';
import { idStruct } from '../python/bpy_rna.js';

// An updated ID's IR key, or null where it has none.
const keyOfPointer = (pointer) => { try { return idKey(idStruct(pointer)) ?? null; } catch { return null; } };
// Datablocks whose change reaches the whole scene: the scene, its world, node groups and collections.
const SCENE_WIDE = /^(SC|WO|NT|GR):/;
// The datablock a table entry is made from: its key's first part, or a property's ID.
const ownerOf = (table, key, entry) => (table === 'properties' ? entry?.id : key.split('/')[0].split('#')[0]);

/**
 * The objects of `last` (packageState's, with its IR's `references`) that a change of `changed` (IR ID keys) reaches:
 * those changed and the objects using what changed, followed from object to object (a constraint's or driver's target,
 * a parent, a modifier's object); the scene and its collections list every object, so they are not followed.
 */
function reached(last, changed) {
  const usedBy = new Map();
  for (const references of Object.values(last.tables.references ?? {})) for (const { from, to } of references) if (from.startsWith('OB:')) (usedBy.get(to) ?? usedBy.set(to, []).get(to)).push(from);
  const seen = new Set(changed);
  for (const key of seen) for (const user of usedBy.get(key) ?? []) seen.add(user);
  return seen;
}

/**
 * The next export's state after a change: `updated`, the ID pointers Blender's depsgraph updated since `last`. Gives
 * packageState's state, made by a Selected Objects export of what the change reaches merged into `last`, or by a whole
 * export when it reaches the scene as a whole or most of it (`share`, of the objects).
 */
export async function exportChanged(world, last, updated, options = {}, { share = 0.5 } = {}) {
  const whole = async () => packageState(await exportPackage(world, options));
  const changed = [...updated].map(keyOfPointer).filter(Boolean);
  // A change the depsgraph did not report (of an object it does not evaluate, a hidden one), or one whose IDs have no
  // key, is found by the whole scene: never an empty patch for a change.
  if (!last || !changed.length || changed.some((key) => SCENE_WIDE.test(key))) return whole();
  const keys = reached(last, changed);
  // Each object's key by its node, as the IR names them (a linked object's has its library).
  const keyOf = new Map(Object.entries(last.tables.ids ?? {}).filter(([, id]) => id.node !== undefined).map(([key, id]) => [id.node, key]));
  const nodes = world.objects.filter((node) => keys.has(keyOf.get(node.id)));
  // A change no object shows (an unused datablock's) may still be in the tables: the whole scene then.
  if (!nodes.length) return whole();
  if (nodes.length > share * world.objects.length) return whole();
  const scoped = await exportPackage(world, { ...options, scope: 'SELECTED', selected: nodes });
  const owned = new Set([...keys, ...nodes.map((node) => keyOf.get(node.id))]);
  const tables = {};
  for (const table of new Set([...Object.keys(last.tables), ...Object.keys(scoped.tables)])) {
    const kept = Object.entries(last.tables[table] ?? {}).filter(([key, entry]) => !owned.has(ownerOf(table, key, entry)));
    const made = Object.entries(scoped.tables[table] ?? {}).filter(([key, entry]) => owned.has(ownerOf(table, key, entry)));
    tables[table] = Object.fromEntries([...kept, ...made]);
  }
  return packageState({ tables, buffers: { ...last.buffers, ...scoped.buffers } });
}
