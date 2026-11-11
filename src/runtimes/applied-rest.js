// A skinned mesh's applied rest for an export: the modifiers around its Armature modifier that nothing animates, applied
// into the mesh Babylon skins, so a Mirror, Mask or Geometry Nodes modifier before the Armature (or after it, a Mask, which
// deforms nothing, or a Subdivision Surface, which then smooths the rest instead of the pose) no longer makes the mesh
// evaluate as Blender. Blender evaluates them: the object with its Armature
// modifier and those after it hidden gives the mesh (Mesh.new_from_object, vertex groups kept), and each shape key,
// pinned, gives its coordinates through the same modifiers, as a temporary object's own keys.
import { blendData, contextStruct, pointerOf } from '../python/bpy_rna.js';
import { blockData, positions } from './key-blocks.js';

const address = (struct) => pointerOf(struct)?.[2] ?? 0;

// Modifiers whose result changes with time or with what they simulate.
const TIMED = new Set(['WAVE', 'OCEAN', 'CLOTH', 'SOFT_BODY', 'DYNAMIC_PAINT', 'EXPLODE', 'PARTICLE_SYSTEM', 'PARTICLE_INSTANCE', 'FLUID',
  'MESH_CACHE', 'MESH_SEQUENCE_CACHE', 'BUILD', 'COLLISION', 'SURFACE', 'HOOK', 'ARMATURE']);
// Geometry nodes whose output follows the scene's time, another object or a simulation.
const DYNAMIC_NODES = new Set(['GeometryNodeInputSceneTime', 'GeometryNodeObjectInfo', 'GeometryNodeCollectionInfo', 'GeometryNodeSelfObject',
  'GeometryNodeInputActiveCamera', 'GeometryNodeSimulationInput', 'GeometryNodeSimulationOutput', 'GeometryNodeBake', 'GeometryNodeInputSceneFrame']);
// What a modifier after the Armature gives applied before it: the same (a Mask of a vertex group's vertices deforms
// nothing), nearly the same (a Subdivision Surface smooths the rest, which the Armature then deforms), else null.
const AFTER = { MASK: (m) => (m.mode === 'VERTEX_GROUP' ? 'SAME' : null), SUBSURF: () => 'NEARLY', MULTIRES: () => 'NEARLY' };
// The most morph target data (floats: a position and a normal per face corner, per shape key) a rest with more vertices
// than its mesh (subdivided) may carry; above it the mesh evaluates as Blender, until the page subdivides after skinning.
const MORPH_FLOATS = 4e6;
const afterArmature = (m) => AFTER[m.type]?.(m) ?? null;

// The data paths an ID's F-Curves key, and with `drivers` those its drivers set too.
const animatedPaths = (id, drivers = true) => {
  const animation = id?.animation_data, action = animation?.action;
  const bags = action ? [...action.layers].flatMap((layer) => [...layer.strips].flatMap((strip) => [...strip.channelbags])) : [];
  return [...bags.flatMap((bag) => [...bag.fcurves]), ...(animation && drivers ? animation.drivers : [])].map((fc) => fc.data_path);
};
const drivenPaths = (id) => [...(id?.animation_data?.drivers ?? [])].map((fc) => fc.data_path);
const settingOf = (m) => (path) => path.startsWith(`modifiers["${m.name}"]`);
const readsOtherID = (m) => [...m.bl_rna.properties].some(({ type, identifier }) => {
  const pointer = type === 'POINTER' && pointerOf(m[identifier]);
  return pointer && pointer[1] === pointer[2];
});
function dynamicTree(tree, seen = new Set()) {
  if (!tree || seen.has(address(tree))) return false;
  seen.add(address(tree));
  return animatedPaths(tree).length > 0 || [...tree.nodes].some((node) => DYNAMIC_NODES.has(node.bl_idname) || (node.node_tree && dynamicTree(node.node_tree, seen)));
}
// A modifier that gives the same mesh at every frame: no F-Curve keys it, it reads no other ID and no time. A driver of
// its settings (a quality switch) keeps the value it gives now.
function still(ob, m, animated) {
  if (TIMED.has(m.type) || animated.some(settingOf(m))) return false;
  if (m.type === 'NODES') return !!m.node_group && !dynamicTree(m.node_group) && !readsOtherID(m);
  return !readsOtherID(m);
}

// Blender's Smooth by Angle (Object > Shade Auto Smooth), last in the stack: Babylon skins the mesh smooth instead.
export const smoothByAngle = (m) => m.type === 'NODES' && /^Smooth by Angle/.test(m.node_group?.name ?? '');
// A mesh object's modifiers shown in the viewport, but a last Smooth by Angle.
export function shownStack(ob) {
  const shown = [...ob.modifiers].filter((m) => m.show_viewport);
  return smoothByAngle(shown.at(-1) ?? {}) ? shown.slice(0, -1) : shown;
}

// The modifiers of a mesh object an applied rest holds, or null when it needs none or cannot have one: all before its
// one Armature modifier and all after it (afterArmature), all still; `nearly`, those after it that give nearly the same.
export function restModifiers(ob) {
  const stack = shownStack(ob), at = stack.findIndex((m) => m.type === 'ARMATURE');
  if (at < 0 || stack.filter((m) => m.type === 'ARMATURE').length > 1) return null;
  const after = stack.slice(at + 1), applied = [...stack.slice(0, at), ...after], animated = animatedPaths(ob, false), driven = drivenPaths(ob);
  if (!applied.length || after.some((m) => !afterArmature(m)) || !applied.every((m) => still(ob, m, animated))) return null;
  return { applied, nearly: after.filter((m) => afterArmature(m) === 'NEARLY').map((m) => m.name), driven: applied.filter((m) => driven.some(settingOf(m))).map((m) => m.name) };
}

// Sets each of `list`'s [struct, property, value] and returns a function that sets them back.
function setAll(list) {
  const saved = list.map(([struct, property]) => [struct, property, struct[property]]);
  for (const [struct, property, value] of list) struct[property] = value;
  return () => { for (const [struct, property, value] of saved.reverse()) struct[property] = value; };
}

// An applied rest of a mesh object: a temporary object `ob` holding the applied Mesh (its vertex groups and attributes) and,
// when the object has shape keys, `key`, each of them through the applied modifiers; `applied`, `nearly` and `driven`
// (those a driver sets), the modifiers' names; `vertices`, the mesh's vertex count and the rest's (a Subdivision Surface at its viewport levels).
function makeRest(ob, { applied, nearly, driven }) {
  const data = blendData(), depsgraph = contextStruct().evaluated_depsgraph_get(), key = ob.data.shape_keys, names = applied.map((m) => m.name);
  const at = [...ob.modifiers].findIndex((m) => m.type === 'ARMATURE' && m.show_viewport);
  const restoreModifiers = setAll([...ob.modifiers].filter((m, i) => i >= at && m.show_viewport && !names.includes(m.name)).map((m) => [m, 'show_viewport', false]));
  // Each key's own coordinates: pinned, unmuted and without its vertex group.
  const evaluate = (index) => {
    const restore = key ? setAll([[ob, 'show_only_shape_key', true], [ob, 'active_shape_key_index', index],
      [key.key_blocks[index], 'mute', false], [key.key_blocks[index], 'vertex_group', '']]) : () => {};
    depsgraph.update();
    const mesh = data.meshes.new_from_object(ob.evaluated_get(depsgraph), true, depsgraph);
    restore();
    return mesh;
  };
  try {
    const mesh = evaluate(0), rest = data.objects.new(`${ob.name} (rest)`, mesh);
    const vertices = [ob.data.vertices.length, mesh.vertices.length];
    if (!key) return { ob: rest, address: address(rest), key: null, applied: names, nearly, driven, vertices };
    const count = mesh.vertices.length, blocks = [...key.key_blocks];
    const discard = () => { data.objects.remove(rest); data.meshes.remove(mesh); return null; };
    if (count > ob.data.vertices.length && mesh.loops.length * 6 * (blocks.length - 1) > MORPH_FLOATS) return discard();
    // A key that moves vertices the modifiers merge or mask gives other topology: the rest would hold at no value.
    const shapes = blocks.map((kb, i) => {
      if (!i) return positions(mesh).slice();
      const shaped = evaluate(i), shape = shaped.vertices.length === count ? positions(shaped).slice() : null;
      data.meshes.remove(shaped);
      return shape;
    });
    if (shapes.some((shape) => !shape)) return discard();
    blocks.forEach((kb, i) => blockData(rest.shape_key_add(kb.name, false), count).set(shapes[i]));
    const own = mesh.shape_keys;
    blocks.forEach((kb, i) => Object.assign(own.key_blocks[i], { relative_key: own.key_blocks.get(kb.relative_key.name), vertex_group: kb.vertex_group,
      slider_min: kb.slider_min, slider_max: kb.slider_max, value: kb.value, mute: kb.mute, interpolation: kb.interpolation }));
    return { ob: rest, address: address(rest), key: own, applied: names, nearly, driven, vertices };
  } finally {
    restoreModifiers();
    depsgraph.update();
  }
}

// The applied rests an export makes, by mesh Object address: `of(ob)` makes one at the first ask (null when the object
// needs none), `byAddress` finds it, and dispose() removes the temporary objects and meshes.
export function appliedRests() {
  const rests = new Map();
  return {
    of(ob) {
      const at = address(ob);
      if (!rests.has(at)) { const modifiers = restModifiers(ob); rests.set(at, modifiers && makeRest(ob, modifiers)); }
      return rests.get(at);
    },
    byAddress: (at) => rests.get(at) ?? null,
    dispose() {
      const data = blendData();
      for (const rest of rests.values()) {
        if (!rest) continue;
        const mesh = rest.ob.data;
        data.objects.remove(rest.ob);
        data.meshes.remove(mesh);
      }
      rests.clear();
    },
  };
}
