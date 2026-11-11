// File > Export's Animations as Clips (export-options.js ANIMATIONS): an animation group per Blender action, named by it,
// as Blender's glTF exporter exports actions and Babylon's glTF loader names its groups. Each action is evaluated alone
// by Blender on the IDs that use it, over its frame range; the first NLA strip playing it gives the group's playback:
// its blending (Add, and Combine approximated as Add, additive), influence (weight), scale (speed) and repeat.
import { Animation, Vector3 } from '@babylonjs/core';
import { pointerOf } from '../python/bpy_rna.js';
import { actionFCurves } from './ir-export.js';

export { isClip } from './runtime/clips.js';

const address = (id) => pointerOf(id)?.[2];
// A test of whether an ID is one of `ids`.
export const ownedBy = (ids) => {
  const addresses = new Set(ids.map(address));
  return (id) => !!id && addresses.has(address(id));
};

// How a clip plays as the first strip using its action plays it, or as the action plays assigned.
function playback(action, strip) {
  const [start, end] = strip ? [strip.action_frame_start, strip.action_frame_end] : action.frame_range;
  return { frame_start: Math.floor(start), frame_end: Math.ceil(end), blend: strip?.blend_type ?? 'REPLACE',
    influence: strip?.use_animated_influence ? strip.influence : 1, speed: strip ? 1 / (Math.abs(strip.scale) || 1) : 1, repeat: strip?.repeat ?? 1 };
}

/**
 * The clips of the actions `ids` use, assigned or in their NLA strips: { name, action, ids, frame_start, frame_end,
 * blend, influence, speed, repeat }, ids being those that use it.
 */
export function actionClips(ids) {
  const clips = new Map();
  const use = (action, id, strip) => {
    if (!action) return;
    if (!clips.has(action.name)) clips.set(action.name, { action, ids: [], strip: null });
    const clip = clips.get(action.name);
    if (!ownedBy(clip.ids)(id)) clip.ids.push(id);
    clip.strip ??= strip;
  };
  for (const id of ids) {
    const adt = id.animation_data;
    if (!adt) continue;
    for (const track of adt.nla_tracks) for (const strip of track.strips) use(strip.action, id, strip);
    use(adt.action, id, null);
  }
  return [...clips.values()].map(({ action, ids: users, strip }) => ({ name: action.name, action, ids: users, ...playback(action, strip) }));
}

// An object's location and Euler rotation components its action does not set, set to 0 for an additive clip's samples
// to hold nothing but the action's; gives what puts them back.
function zeroUnset(id) {
  if (!id.location) return () => {};
  const curves = actionFCurves(id.animation_data), saved = [];
  for (const path of ['location', 'rotation_euler']) for (let i = 0; i < 3; i++) {
    if (curves.some((fc) => fc.data_path === path && fc.array_index === i)) continue;
    saved.push([path, i, id[path][i]]);
    id[path][i] = 0;
  }
  return () => saved.forEach(([path, i, value]) => { id[path][i] = value; });
}

/**
 * Runs `sample` with `action` alone animating `ids`: assigned to each, its NLA off; then gives each its animation data
 * back. With `additive`, an object's transform the action leaves alone is zero meanwhile.
 */
export function withAction(ids, action, sample, { additive = false } = {}) {
  const saved = ids.map((id) => { const adt = id.animation_data; return { id, adt, action: adt.action, slot: adt.action_slot, use_nla: adt.use_nla }; });
  const restores = [];
  try {
    for (const { id, adt } of saved) {
      adt.action = action;
      adt.use_nla = false;
      if (additive) restores.push(zeroUnset(id));
    }
    return sample();
  } finally {
    restores.forEach((restore) => restore());
    for (const { adt, action: own, slot, use_nla } of saved) {
      adt.action = own;
      if (own && slot && adt.action_slot?.handle !== slot.handle) adt.action_slot = slot;
      adt.use_nla = use_nla;
    }
  }
}

// What an additive clip's keys are deltas from where they are not already: a bone's rest pose, an unscaled scale.
function reference(animation, target) {
  if (animation.dataType === Animation.ANIMATIONTYPE_MATRIX) return target.getRestMatrix().clone();
  if (!animation.targetProperty.startsWith('scaling')) return null;
  return animation.dataType === Animation.ANIMATIONTYPE_VECTOR3 ? Vector3.One() : 1;
}
/** An animation of an additive clip as deltas, as Babylon's MakeAnimationAdditive makes them, from its reference frame. */
export function additive(animation, target) {
  const value = reference(animation, target);
  if (value === null) return animation;
  // Babylon's reference is the first key at frame 0: the reference value is put there, the keys after it, then taken out.
  const keys = animation.getKeys(), shift = 1 - keys[0].frame;
  animation.setKeys([{ frame: 0, value }, ...keys.map((key) => ({ ...key, frame: key.frame + shift }))]);
  Animation.MakeAnimationAdditive(animation);
  animation.setKeys(animation.getKeys().slice(1).map((key) => ({ ...key, frame: key.frame - shift })));
  return animation;
}

/**
 * A clip's animation group as Babylon's glTF loader makes one: normalized to start at 0, looping, not started, with
 * the strip's playback. `targetedAnimations`: serialized, at the action's frames.
 */
export function clipGroup({ name, frame_start, frame_end, blend, influence, speed }, targetedAnimations) {
  for (const { animation } of targetedAnimations) for (const key of animation.keys) key.frame -= frame_start;
  const isAdditive = blend !== 'REPLACE';
  return { name, from: 0, to: frame_end - frame_start, speedRatio: speed, loopAnimation: true, isAdditive, weight: isAdditive || influence < 1 ? influence : -1,
    playOrder: 0, targetedAnimations, metadata: { bylonder: { clip: true, action: name, frame_start } } };
}

/** The clips as the IR's scene time records them (runtime/ir.js ClipSchema), by name, with their actions' pose markers. */
export const irClips = (clips) => Object.fromEntries(clips.map(({ name, action, frame_start, frame_end, blend, influence, speed, repeat }) => [name, {
  action: action.name, frame_start, frame_end, blend, influence, speed, repeat,
  markers: [...(action.pose_markers ?? [])].map((m) => ({ name: m.name, frame: m.frame })) }]));
