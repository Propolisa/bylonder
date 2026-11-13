// Limbs (runtime/character/effects/limbs.js) on the basic rig, which has no IK controls: the two-bone solve puts a
// foot on a target in reach with the knee bending forward and the foot's world rotation kept, and stops at full
// extension toward one out of reach, saying how far short it is.
import assert from 'node:assert/strict';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { createPoseApi } from '../src/io_scene_babylon/runtime/character/pose-api.js';
import { STRIDE } from '../src/io_scene_babylon/runtime/character/pose.js';
import { sampleClip } from '../src/io_scene_babylon/runtime/character/clip.js';
import { createLimb } from '../src/io_scene_babylon/runtime/character/effects/limbs.js';
import { moveWorld, worldOf } from '../src/io_scene_babylon/runtime/character/effects/space.js';
import { basicRig } from './fixtures/basic-rig.js';
import { snowRig } from './fixtures/snow-rig.js';

const { skeleton, clips } = basicRig();
const bone = (name) => skeleton.boneIndex(`mixamorig:${name}`);
const character = { rig: skeleton, blend: null, armature: 'Armature' };
const data = Float32Array.from(skeleton.rest), root = Matrix.Identity();
const pose = createPoseApi(data, skeleton.parents, () => root);
const leg = createLimb(character, ['LeftUpLeg', 'LeftLeg', 'LeftFoot'].map(bone));
assert.equal(leg.ikWeight(), 0, 'no IK controls');
assert.ok(Math.abs(leg.length - 0.9) < 1e-5, `the leg is 0.9 m (${leg.length})`);

const before = new Quaternion(), after = new Quaternion(), foot = new Vector3(), knee = new Vector3();
for (const [what, target] of [['a step up', new Vector3(0.12, 0.25, 0.1)], ['back and down', new Vector3(0.08, 0.1, -0.2)]]) {
  sampleClip(clips.get('Idle'), 0.5, data);
  worldOf(pose, bone('LeftFoot'), null, before);
  const short = leg.reach(pose, target, 1);
  worldOf(pose, bone('LeftFoot'), foot, after);
  worldOf(pose, bone('LeftLeg'), knee);
  assert.equal(short, 0, `${what}: in reach`);
  assert.ok(Vector3.Distance(foot, target) < 1e-3, `${what}: the ankle on the target (${foot})`);
  assert.ok(knee.z > Math.min(target.z, 0) + 0.02, `${what}: the knee bends forward (${knee})`);
  assert.ok(Math.abs(Quaternion.Dot(before, after)) > 0.9999, `${what}: the foot keeps its world rotation`);
}

// Out of reach: straight toward it, 0.2 m short.
sampleClip(clips.get('Idle'), 0.5, data);
const hip = leg.rootAt(pose, new Vector3()), far = hip.add(new Vector3(0, -1.1, 0.0));
const short = leg.reach(pose, far, 1);
assert.ok(Math.abs(short - 0.2) < 1e-3, `0.2 m short (${short})`);
worldOf(pose, bone('LeftFoot'), foot);
assert.ok(Vector3.Distance(foot, hip.add(new Vector3(0, -0.9, 0))) < 2e-3, `fully extended toward it (${foot})`);

// Half weight lands halfway in angle, not on the target.
sampleClip(clips.get('Idle'), 0.5, data);
leg.reach(pose, new Vector3(0.12, 0.3, 0.15), 0.5);
worldOf(pose, bone('LeftFoot'), foot);
assert.ok(Vector3.Distance(foot, new Vector3(0.12, 0.3, 0.15)) > 0.05, 'half weight stops short');

// Snow, a CloudRig rig: its arm plays the FK bones while the IK/FK switch is at FK, so the solve turns FK-UpperArm.L
// and FK-Forearm.L, the elbow only about its X axis (the IK chain's locks); in IK it moves the IK target instead.
for (const ik of [0, 1]) {
  const snow = snowRig({ ik }), { rig } = snow, i = (name) => rig.boneIndex(name);
  const posed = Float32Array.from(rig.rest), snowPose = createPoseApi(posed, rig.parents, () => root);
  const arm = createLimb(snow, snow.roles['arm.L'].map(i));
  assert.equal(arm.ikWeight(), ik, `the switch reads ${ik}`);
  const shoulder = arm.rootAt(snowPose, new Vector3()), hand = arm.endAt(snowPose, new Vector3());
  const target = Vector3.Lerp(shoulder, hand, 0.7).add(new Vector3(0, 0, 0.1));
  assert.equal(arm.reach(snowPose, target, 1), 0, `in reach (ik ${ik})`);
  assert.ok(Vector3.Distance(arm.endAt(snowPose, hand), target) < 1e-3, `the hand on the target (ik ${ik}): ${hand}`);
  const elbow = new Quaternion();
  snowPose.rotation(i('FK-Forearm.L'), elbow);
  const o = i('FK-Forearm.L') * 10, rest = new Quaternion(rig.rest[o + 3], rig.rest[o + 4], rig.rest[o + 5], rig.rest[o + 6]);
  Quaternion.Inverse(rest).multiplyToRef(elbow, elbow);
  if (ik) assert.ok(Math.abs(elbow.w) > 1 - 1e-6, 'in IK the FK bones are left alone');
  else assert.ok(Math.hypot(elbow.y, elbow.z) < 1e-3, `the elbow bends about X only (${elbow})`);
}

// Snow's FK chain hangs from FK-HNG-Thigh.L, which its constraints place where the hips carry the leg; before the
// solve it still sits at rest. With the hips lowered 10 cm, the leg still puts its foot on the target.
{
  const snow = snowRig(), { rig, root: up } = snow, i = (name) => rig.boneIndex(name);
  const posed = Float32Array.from(rig.rest), snowPose = createPoseApi(posed, rig.parents, () => up);
  const leg = createLimb(snow, snow.roles['leg.L'].map(i)), foot = leg.endAt(snowPose, new Vector3());
  const hips = i('Hips');
  moveWorld(snowPose, hips, new Vector3(0, -0.1, 0));
  const target = foot.add(new Vector3(0, 0.05, 0.08));
  assert.equal(leg.reach(snowPose, target, 1), 0, 'in reach');
  assert.ok(Vector3.Distance(leg.endAt(snowPose, new Vector3()), target) < 1e-3, 'the foot on the target, the leg hung from the lowered hips');
}

// The rig's own solve draws Snow's foot away from where the posed FK bones predict it (CloudRig's FK hinge), by an
// amount that changes as the body moves: here 5 to 15 cm, cycling about once a second at 60 frames a second. The limb
// reads where the solve put the drawn foot (Foot.L) last frame and corrects its aim, so a planted foot is drawn within
// 1 cm of where it was planted (15 cm off without the correction).
{
  const snow = snowRig(), { rig, root: up } = snow, i = (name) => rig.boneIndex(name);
  const posed = Float32Array.from(rig.rest), snowPose = createPoseApi(posed, rig.parents, () => up);
  const offset = new Vector3(), drawnAt = new Vector3(), fk = new Vector3();
  const drawn = { computeWorldMatrix: () => ({ getTranslationToRef: (out) => out.copyFrom(drawnAt) }) };
  const character = { ...snow, frame: 0, bone: (name) => (name === 'Foot.L' ? drawn : null) };
  const leg = createLimb(character, snow.roles['leg.L'].map(i));
  /** The rig's solve: the FK foot as posed, moved by this frame's offset. */
  const solve = (k) => {
    offset.set(0.1 + 0.05 * Math.sin(k * 0.1), 0, 0.05 * Math.cos(k * 0.08));
    worldOf(snowPose, i('FK-Foot.L'), fk);
    drawnAt.copyFrom(fk).addInPlace(offset);
  };
  posed.set(rig.rest);
  solve(0);
  const planted = drawnAt.clone().add(new Vector3(0, 0.05, 0.05));
  let worst = 0;
  for (let k = 1; k < 60; k++) {
    character.frame = k;
    posed.set(rig.rest);
    leg.reach(snowPose, planted, 1);
    solve(k);
    if (k > 1) worst = Math.max(worst, Vector3.Distance(drawnAt, planted));
  }
  assert.ok(worst < 0.01, `the drawn foot held within 1 cm of where it was planted (${(worst * 100).toFixed(2)} cm)`);
}

// A pivot: the body turns at 2.5 rad/s, so the solve's offset from the posed foot turns with it (a 15 cm arm about
// the up axis, about 6 mm a frame). Carried on at its rate, the correction keeps the planted foot within 1 cm.
{
  const snow = snowRig(), { rig, root: up } = snow, i = (name) => rig.boneIndex(name);
  const posed = Float32Array.from(rig.rest), snowPose = createPoseApi(posed, rig.parents, () => up);
  const drawnAt = new Vector3(), fk = new Vector3();
  const drawn = { computeWorldMatrix: () => ({ getTranslationToRef: (out) => out.copyFrom(drawnAt) }) };
  const character = { ...snow, frame: 0, bone: (name) => (name === 'Foot.L' ? drawn : null) };
  const leg = createLimb(character, snow.roles['leg.L'].map(i));
  const solve = (k) => {
    const yaw = 2.5 * k / 60;
    worldOf(snowPose, i('FK-Foot.L'), fk);
    drawnAt.copyFrom(fk).addInPlaceFromFloats(0.15 * Math.sin(yaw), 0, 0.15 * Math.cos(yaw));
  };
  posed.set(rig.rest);
  solve(0);
  const planted = drawnAt.clone().add(new Vector3(0, 0.05, 0.05));
  let worst = 0;
  for (let k = 1; k < 40; k++) {
    character.frame = k;
    posed.set(rig.rest);
    leg.reach(snowPose, planted, 1);
    solve(k);
    if (k > 2) worst = Math.max(worst, Vector3.Distance(drawnAt, planted));
  }
  assert.ok(worst < 0.01, `turning, the drawn foot held within 1 cm (${(worst * 100).toFixed(2)} cm)`);
}

// The solve keeps the knee on the side the clip bends it, whichever that is and whatever the rig's hinge limits say:
// a foot raised 3 cm bends the knee further the same way (Snow's legs had their knees mirrored backwards).
// The played bones are Snow's FK chain, the mannequin's leg itself.
const mannequinLeg = ['LeftUpLeg', 'LeftLeg', 'LeftFoot'].map((n) => `mixamorig:${n}`);
for (const [name, rig, chain, played] of [['the mannequin', character, mannequinLeg, mannequinLeg], ['Snow', snowRig(), null, ['FK-Thigh.L', 'FK-Knee.L', 'FK-Foot.L']]]) {
  const bones = rig.rig, at = (n) => bones.boneIndex(n), up = rig.root ?? root;
  const posed = Float32Array.from(bones.rest), legPose = createPoseApi(posed, bones.parents, () => up);
  const leg = createLimb(rig, (chain ?? rig.roles['leg.L']).map(at)), [hipBone, kneeBone, ankleBone] = played.map(at);
  const offset = (out) => {
    const [hip, k, ankle] = [hipBone, kneeBone, ankleBone].map((b) => { const p = new Vector3(); worldOf(legPose, b, p); return p; });
    const line = ankle.subtract(hip), along = Vector3.Dot(k.subtract(hip), line) / line.lengthSquared();
    return out.copyFrom(k.subtract(hip.add(line.scale(along))));
  };
  for (const sign of [1, -1]) {
    posed.set(bones.rest);
    const o = kneeBone * STRIDE, bent = Quaternion.RotationAxis(Vector3.Right(), 0.5 * sign);
    const turned = new Quaternion(posed[o + 3], posed[o + 4], posed[o + 5], posed[o + 6]).multiply(bent);
    posed.set([turned.x, turned.y, turned.z, turned.w], o + 3);
    const before = offset(new Vector3()), target = leg.endAt(legPose, new Vector3()).add(new Vector3(0, 0.03, 0));
    leg.reach(legPose, target, 1);
    const after = offset(new Vector3());
    assert.ok(Vector3.Dot(before, after) > 0 && after.length() > before.length(), `${name}, bent ${sign > 0 ? 'one' : 'the other'} way: the knee bends further the same way (${(before.length() * 100).toFixed(1)} to ${(after.length() * 100).toFixed(1)} cm, ${Vector3.Dot(before.normalize(), after.normalize()).toFixed(2)})`);
  }
}

console.log('character effects limbs: ok');
