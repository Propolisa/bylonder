// The basic test rig: a Mixamo-named skeleton (Y up, facing +Z, metres, bones unrotated at rest) with Idle, Walk, Run
// and Jump made in code, in place, without markers or root motion, as a Mixamo download has them. Each clip's legs are
// solved from where its feet should be, so its truth (ground speed, cycle, when each foot is down) is known exactly.
import { STRIDE, createPose } from '../../src/io_scene_babylon/runtime/character/pose.js';
import { createClip } from '../../src/io_scene_babylon/runtime/character/clip.js';

const FPS = 30, THIGH = 0.45, SHIN = 0.45, ANKLE = 0.08, HIP_WIDTH = 0.1;
const STANDING = THIGH + SHIN + ANKLE;

/** [name, parent, offset from the parent's head] */
const BONES = /** @type {[string, string | null, number[]][]} */ ([
  ['Hips', null, [0, STANDING, 0]],
  ['Spine', 'Hips', [0, 0.1, 0]], ['Spine1', 'Spine', [0, 0.12, 0]], ['Spine2', 'Spine1', [0, 0.12, 0]],
  ['Neck', 'Spine2', [0, 0.15, 0]], ['Head', 'Neck', [0, 0.1, 0]], ['HeadTop_End', 'Head', [0, 0.18, 0]],
  ['LeftEye', 'Head', [0.03, 0.07, 0.08]], ['RightEye', 'Head', [-0.03, 0.07, 0.08]],
  ...['Left', 'Right'].flatMap((side) => {
    const x = side === 'Left' ? 1 : -1;
    return /** @type {[string, string, number[]][]} */ ([
      [`${side}UpLeg`, 'Hips', [x * HIP_WIDTH, 0, 0]], [`${side}Leg`, `${side}UpLeg`, [0, -THIGH, 0]],
      [`${side}Foot`, `${side}Leg`, [0, -SHIN, 0]], [`${side}ToeBase`, `${side}Foot`, [0, -ANKLE, 0.12]],
      [`${side}Shoulder`, 'Spine2', [x * 0.05, 0.12, 0]], [`${side}Arm`, `${side}Shoulder`, [x * 0.12, 0, 0]],
      [`${side}ForeArm`, `${side}Arm`, [x * 0.28, 0, 0]], [`${side}Hand`, `${side}ForeArm`, [x * 0.25, 0, 0]],
    ]);
  }),
]).map(([name, parent, offset]) => [`mixamorig:${name}`, parent && `mixamorig:${parent}`, offset]);

/** Each clip's cycle: when each foot is down, as [start, end] shares of it (end may pass 1, wrapping). */
const CYCLES = {
  Idle: { speed: 0, period: 2, loop: true, down: { L: [[0, 1]], R: [[0, 1]] } },
  Walk: { speed: 1.2, period: 1, loop: true, down: { L: [[0, 0.6]], R: [[0.5, 1.1]] } },
  Run: { speed: 3.5, period: 0.7, loop: true, down: { L: [[0, 0.35]], R: [[0.5, 0.85]] } },
  Jump: { speed: 0, period: 1.1, loop: false, down: { L: [[0, 0.3], [0.8, 1]], R: [[0, 0.3], [0.8, 1]] }, air: [0.3, 0.8] },
};

/**
 * Each clip's truth: `speed` the ground speed its feet imply (m/s), `period` its length (s), `contacts` when each foot
 * is down as [start, end] windows in seconds (an end may pass `period`, wrapping), `air` when a jump is off the ground.
 */
export const TRUTH = Object.fromEntries(Object.entries(CYCLES).map(([name, { down, air, period, ...rest }]) => {
  const seconds = (/** @type {number[]} */ span) => span.map((s) => s * period);
  return [name, { ...rest, period, contacts: { L: down.L.map(seconds), R: down.R.map(seconds) }, ...(air && { air: seconds(air) }) }];
}));

const about = (/** @type {number[]} */ axis, /** @type {number} */ angle) => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

/**
 * Turns about X that put a leg's ankle at (z, y) from its hip joint, the knee bending forward, and keep the foot flat.
 * @returns {[number, number, number]} thigh, knee, foot
 */
function legAngles(/** @type {number} */ z, /** @type {number} */ y) {
  const reach = Math.min(Math.hypot(z, y), THIGH + SHIN - 1e-4), toward = Math.atan2(z, -y);
  const atHip = Math.acos((THIGH ** 2 + reach ** 2 - SHIN ** 2) / (2 * THIGH * reach));
  const atAnkle = Math.acos((SHIN ** 2 + reach ** 2 - THIGH ** 2) / (2 * SHIN * reach));
  const thigh = -(toward + atHip), knee = atHip + atAnkle;
  return [thigh, knee, -(thigh + knee)];
}

/**
 * A foot of a cycle at `phase`: down over [start, end], sliding back at the clip's speed; else swinging forward,
 * lifted by `lift`. Gives its ankle's z and height above the ground.
 */
function cycleFoot(/** @type {number} */ phase, /** @type {number[]} */ [start, end], /** @type {number} */ stride, /** @type {number} */ lift) {
  const down = end - start, p = (((phase - start) % 1) + 1) % 1;
  if (p <= down) return [stride / 2 - (p / down) * stride, ANKLE];
  const s = (p - down) / (1 - down);
  return [-stride / 2 + (0.5 - 0.5 * Math.cos(Math.PI * s)) * stride, ANKLE + lift * Math.sin(Math.PI * s)];
}

/**
 * The basic rig and its clips. `skeleton` has the shape the character's rig gives (names, parents, rest pose,
 * boneIndex); `clips` are by action name.
 */
export function basicRig() {
  const names = BONES.map((b) => b[0]), index = new Map(names.map((n, i) => [n, i]));
  const parents = Int32Array.from(BONES.map((b) => (b[1] ? /** @type {number} */ (index.get(b[1])) : -1)));
  const rest = createPose(names.length);
  BONES.forEach(([, , offset], i) => rest.set(offset, i * STRIDE));
  const bone = (/** @type {string} */ name) => /** @type {number} */ (index.get(`mixamorig:${name}`));
  const skeleton = { names, parents, rest, boneIndex: (/** @type {string} */ name) => index.get(name) ?? -1 };

  /** A clip of `seconds` from `poseAt(t, pose)`, which turns the rest pose it is given. */
  const clip = (/** @type {string} */ name, /** @type {number} */ seconds, /** @type {(t: number, pose: Float32Array) => void} */ poseAt) => {
    const frames = Math.round(seconds * FPS) + 1, size = names.length * STRIDE, data = new Float32Array(frames * size), pose = createPose(names.length);
    for (let f = 0; f < frames; f++) {
      pose.set(rest);
      poseAt(f / FPS, pose);
      data.set(pose, f * size);
    }
    return createClip(name, FPS, names.map((_, i) => i), data);
  };
  const turn = (/** @type {Float32Array} */ pose, /** @type {string} */ name, /** @type {number[]} */ axis, /** @type {number} */ angle) => pose.set(about(axis, angle), bone(name) * STRIDE + 3);
  const legs = (/** @type {Float32Array} */ pose, /** @type {number} */ hips, /** @type {number[][]} */ feet) => {
    pose[bone('Hips') * STRIDE + 1] = hips;
    ['Left', 'Right'].forEach((side, k) => {
      const [thigh, knee, foot] = legAngles(feet[k][0], feet[k][1] - hips);
      turn(pose, `${side}UpLeg`, X, thigh);
      turn(pose, `${side}Leg`, X, knee);
      turn(pose, `${side}Foot`, X, foot);
    });
  };
  const arms = (/** @type {Float32Array} */ pose, /** @type {number} */ swing) => {
    turn(pose, 'LeftArm', Z, -1.3);
    turn(pose, 'RightArm', Z, 1.3);
    turn(pose, 'LeftShoulder', X, -swing);
    turn(pose, 'RightShoulder', X, swing);
  };
  const gait = (/** @type {'Walk' | 'Run'} */ name, /** @type {number} */ hips, /** @type {number} */ lift, /** @type {number} */ swing) => {
    const { speed, period, down } = CYCLES[name], stride = speed * period * (down.L[0][1] - down.L[0][0]);
    return clip(name, period, (t, pose) => {
      const phase = t / period, bob = 0.02 * Math.cos(4 * Math.PI * phase);
      legs(pose, hips + bob, [cycleFoot(phase, down.L[0], stride, lift), cycleFoot(phase, down.R[0], stride, lift)]);
      arms(pose, swing * Math.cos(2 * Math.PI * phase));
      turn(pose, 'Spine', Y, 0.08 * Math.cos(2 * Math.PI * phase));
    });
  };
  const idle = clip('Idle', CYCLES.Idle.period, (t, pose) => {
    const breath = Math.sin(Math.PI * t);
    legs(pose, STANDING - 0.03 - 0.005 * breath, [[0.02, ANKLE], [-0.02, ANKLE]]);
    arms(pose, 0);
    turn(pose, 'Spine1', X, 0.02 * breath);
  });
  const jump = clip('Jump', CYCLES.Jump.period, (t, pose) => {
    const { period, air } = CYCLES.Jump, [up, down] = air.map((a) => a * period);
    const crouch = t < up ? Math.sin((Math.PI * t) / up) * 0.2 : t > down ? Math.sin((Math.PI * (t - down)) / (period - down)) * 0.2 : 0;
    const tuck = t > up && t < down ? Math.sin((Math.PI * (t - up)) / (down - up)) * 0.25 : 0;
    legs(pose, STANDING - 0.03 - crouch, [[0.05, ANKLE + tuck], [-0.05, ANKLE + tuck]]);
    arms(pose, -crouch * 2);
  });
  const clips = new Map([idle, gait('Walk', 0.88, 0.12, 0.4), gait('Run', 0.8, 0.25, 0.9), jump].map((c) => [c.name, c]));
  return { skeleton, clips, truth: TRUTH };
}
