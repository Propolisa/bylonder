// The tables a package's scene.js holds (runtime/scene-tables.js loads them), each entry keyed by the datablock it is
// made from, as the IR keys IDs (`OB:Cube`, `MA:Lava`), so that what one datablock gives can be replaced alone. What
// comes from no datablock of the IR is keyed by its table and its Babylon name.
import { idStruct } from '../python/bpy_rna.js';
import { idKey } from './ir-export.js';
import { isClip } from './clip-export.js';

// `entries` by key: the first entry of a key takes it, the next `<key>#2` and so on.
export function keyed(entries, keyOf) {
  const table = {};
  for (const entry of entries) {
    const key = keyOf(entry);
    let unique = key;
    for (let n = 2; unique in table; n++) unique = `${key}#${n}`;
    table[unique] = entry;
  }
  return table;
}

/**
 * The key of each table's entries, by table: an object's node, light and camera by its object's key in the IR; a
 * material by its Material's (or World's) key; what belongs to an object (its geometry, by the id of the node first
 * using it, shape keys, shadows, an armature's skeleton) by the object's key and what it is; an action's clip by the
 * action's key. `meshes`: the serialized meshes, which name their materials and morph target managers.
 */
export function tableKeys(world, ir, meshes) {
  const sync = world.mainSync, { scene } = world;
  const objectKeys = new Map(Object.entries(ir.ids).filter(([, id]) => id.node !== undefined).map(([key, id]) => [id.node, key]));
  const objectKey = (id, fallback) => objectKeys.get(id) ?? fallback;
  const materialKey = (entry) => {
    const ma = sync?.materialOf(scene.getMaterialByUniqueId(entry.uniqueId));
    return ma ? idKey(idStruct(ma)) : `material:${entry.name}`;
  };
  const meshOf = (field, id) => meshes.find((mesh) => mesh[field] === id);
  return {
    materials: materialKey,
    multiMaterials: (entry) => `${objectKey(meshOf('materialUniqueId', entry.uniqueId)?.id, `multimaterial:${entry.name}`)}/slots`,
    skeletons: (entry) => (ir.ids[`OB:${entry.name}`] ? `OB:${entry.name}` : `skeleton:${entry.name}`),
    morphTargets: (entry) => `${objectKey(meshOf('morphTargetManagerId', entry.id)?.id, `morph:${entry.id}`)}/shape_keys`,
    geometries: (user) => `${objectKey(user, `geometry:${user}`)}/mesh`,
    nodes: (entry) => objectKey(entry.id, `node:${entry.id}`),
    lights: (entry) => objectKey(entry.id, `light:${entry.id}`),
    cameras: (entry) => objectKey(entry.id, `camera:${entry.id}`),
    reflectionProbes: (entry) => `probe:${entry.name}`,
    shadowGenerators: (entry) => `${objectKey(entry.lightId, `light:${entry.lightId}`)}/shadows`,
    particleSystems: (entry) => `particles:${entry.name}`,
    animationGroups: (entry) => (isClip(entry) ? `AC:${entry.metadata.bylonder.action}` : `group:${entry.name}`),
    // The datablock an animation's target belongs to: an object's node, an armature's bone, a mesh's shape key.
    animations: (targetId) => {
      const target = scene.getNodeById(targetId), skeleton = target?.getSkeleton?.();
      if (skeleton) return ir.ids[`OB:${skeleton.name}`] ? `OB:${skeleton.name}` : `skeleton:${skeleton.name}`;
      if (target) return objectKey(target.id, `node:${target.id}`);
      const manager = scene.morphTargetManagers?.find((m) => [...Array(m.numTargets).keys()].some((i) => m.getTarget(i).id === targetId));
      const mesh = manager && scene.meshes.find((m) => m.morphTargetManager === manager);
      return mesh ? `${objectKey(mesh.id, `node:${mesh.id}`)}/shape_keys` : 'scene';
    },
  };
}

// The IR's parts as tables (docs/ir.md): IDs, collections, properties, graphs and entities by their keys, references by
// the ID they start from, the rate each baked object is sampled at by its name, and the scene's own settings as one
// entry. `order` is made again from the entities.
export function irTables({ ids, collections, properties, graphs, entities, references, scene }) {
  const referencesFrom = {};
  for (const reference of references) (referencesFrom[reference.from] ??= []).push(reference);
  const { sample_rates: sampleRates, ...time } = scene.time;
  return { ids, collections, properties, graphs, entities, references: referencesFrom, sampleRates, irScene: { scene: { ...scene, time } } };
}

/**
 * Animation groups as tables: each group's own settings by the group's key, and its tracks by the datablock they
 * animate, then by group, so that what one datablock's animation gives can be replaced alone. `pack` packs a list of
 * groups' keys into scene.bin (clip-export.js binaryClipKeys).
 */
export function animationTables(groups, keys, pack) {
  const parts = [];
  for (const group of groups) {
    const byId = new Map();
    for (const track of group.targetedAnimations) {
      const id = keys.animations(track.targetId);
      byId.set(id, [...(byId.get(id) ?? []), track]);
    }
    for (const [id, targetedAnimations] of byId) parts.push({ id, group, part: { ...group, targetedAnimations } });
  }
  const packed = pack(parts.map(({ part }) => part)), groupKeys = new Map();
  const table = keyed(groups, (group) => keys.animationGroups(group));
  for (const [key, group] of Object.entries(table)) groupKeys.set(group, key);
  const animations = {};
  parts.forEach(({ id, group }, i) => {
    const { targetedAnimations, bylonderTracks } = packed[i];
    (animations[id] ??= {})[groupKeys.get(group)] = { targetedAnimations, ...(bylonderTracks && { bylonderTracks }) };
  });
  const groupTable = Object.fromEntries(Object.entries(table).map(([key, { targetedAnimations, ...settings }]) => [key, settings]));
  return { animationGroups: groupTable, animations };
}
