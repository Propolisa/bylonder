// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { normalizedCols, scaleOf, mat } from '../math.js';
import { eulerOf } from '../euler.js';
import { evaluateFCurve } from '../drivers/fcurve.js';
import { composeBasis, ROT } from '../rig/m4.js';
import { mixInto } from '../rig/mix.js';
import { ringMatrix } from '../spaces.js';
import { slotName } from '../anim/animation.js';

// ACTION (specs/action.md): the owner's transform from an Action at a frame chosen by a target channel or by
// Evaluation Time, mixed with the owner as Copy Transforms mixes.
const PROPS = ['location', 'rotation_euler', 'rotation_quaternion', 'rotation_axis_angle', 'scale'];
const CHANNEL = /^(LOCATION|ROTATION|SCALE)_([XYZ])$/;

export default {
  type: 'ACTION',
  targets: 'optional',
  defaults: {
    use_eval_time: false, eval_time: 0, transform_channel: 'LOCATION_X', min: 0, max: 0, frame_start: 0, frame_end: 0,
    use_bone_object_action: false,
  },
  // The owner's F-Curves in the action slot, by property and index, resolved once.
  compile(s, { program, owner }) {
    const action = program.actions.get(s.action);
    if (!action) return;
    const slot = slotName(action, s.action_slot, s.last_slot_identifier);
    const prefix = owner.bone >= 0 && !s.use_bone_object_action ? `pose.bones["${program.bones[owner.bone].name}"].` : '';
    const channels = {};
    for (const fc of action.fcurves ?? []) {
      if (fc.slot && slot && fc.slot !== slot) continue;
      if (!fc.data_path.startsWith(prefix)) continue;
      const prop = fc.data_path.slice(prefix.length);
      if (!PROPS.includes(prop)) continue;
      (channels[prop] ??= [])[fc.array_index ?? 0] = fc;
    }
    s._channels = channels;
  },
  evaluate(owner, target, s, spaces) {
    if (!s._channels) return null;
    let f;
    if (s.use_eval_time) f = s.eval_time;
    else {
      if (!target) return null;
      const v = channelValue(target, s.transform_channel);
      f = s.max === s.min ? 0 : Math.min(1, Math.max(0, (v - s.min) / (s.max - s.min)));
    }
    const frame = s.frame_start + f * (s.frame_end - s.frame_start);
    // The action matrix depends only on the frame (and the owner's rotation mode): kept until the frame changes.
    if (s._frame !== frame || s._mode !== spaces.rotationMode) {
      s._A = actionMatrix(s._channels, frame, spaces.rotationMode);
      s._frame = frame; s._mode = spaces.rotationMode;
    }
    const A = s._A;
    const mode = s.mix_mode ?? (spaces.ent.kind === 'bone' ? 'BEFORE_SPLIT' : 'AFTER');
    return mixInto(ringMatrix(), mode, owner, A);
  },
};

function channelValue(m, channel) {
  const [, kind, axis] = CHANNEL.exec(channel) ?? [, 'LOCATION', 'X'];
  const i = 'XYZ'.indexOf(axis);
  if (kind === 'LOCATION') return m[12 + i];
  if (kind === 'SCALE') return scaleOf(m)[i];
  return (eulerOf(normalizedCols(m), 'XYZ')[i] * 180) / Math.PI;
}

const value = (channels, prop, i, frame, fallback) => {
  const fc = channels[prop]?.[i];
  return fc ? evaluateFCurve(fc, frame) : fallback;
};

function actionMatrix(channels, frame, rotationMode) {
  const code = ROT[rotationMode] ?? ROT.XYZ;
  const loc = [0, 1, 2].map((i) => value(channels, 'location', i, frame, 0));
  const scale = [0, 1, 2].map((i) => value(channels, 'scale', i, frame, 1));
  let rot;
  if (code === ROT.QUATERNION) rot = [0, 1, 2, 3].map((i) => value(channels, 'rotation_quaternion', i, frame, i ? 0 : 1));
  else if (code === ROT.AXIS_ANGLE) rot = [0, 1, 2, 3].map((i) => value(channels, 'rotation_axis_angle', i, frame, i === 2 ? 1 : 0));
  else rot = [0, 1, 2].map((i) => value(channels, 'rotation_euler', i, frame, 0)).concat(0);
  const out = mat();
  composeBasis(out, 0, loc, 0, rot, 0, code, scale, 0);
  return out;
}
