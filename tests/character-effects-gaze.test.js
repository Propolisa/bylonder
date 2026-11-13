// The gaze effect (runtime/character/effects/gaze.js) on the basic rig: the head turns to a target to its right, the
// eyes ahead of it; of two targets the nearer is watched; the intent's look wins; a target behind or out of view is let
// go, and one at the side turns the head without rolling it; leaning into a jump, the chest twists toward a target at the
// side without bending sideways; a target beyond `near` is ignored; the same seed glances the same way; Snow's eyes turn by their track targets.
import assert from 'node:assert/strict';
import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { gaze } from '../src/io_scene_babylon/runtime/character/effects/index.js';
import { about, turnWorld, worldOf } from '../src/io_scene_babylon/runtime/character/effects/space.js';
import { aimChain, createEye, forwardIn, lookOf } from '../src/io_scene_babylon/runtime/character/effects/aim.js';
import { createPoseApi } from '../src/io_scene_babylon/runtime/character/pose-api.js';
import { snowRig } from './fixtures/snow-rig.js';

const DT = 1 / 60;
const make = () => new Character(basicBlend(), 'Armature', { manual: true, idle: false });
const run = (hero, seconds) => { for (let t = 0; t < seconds; t += DT) hero.update(DT); };
/** The angle (radians) between a bone's face and the direction to `point`. */
function offBy(hero, name, point) {
  const bone = hero.rig.boneIndex(`mixamorig:${name}`), head = hero.rig.boneIndex('mixamorig:Head');
  const eyes = ['LeftEye', 'RightEye'].map((n) => hero.rig.boneIndex(`mixamorig:${n}`));
  const look = lookOf(hero.poseApi, bone, forwardIn(hero, head, eyes, bone), new Vector3()), at = new Vector3();
  worldOf(hero.poseApi, bone, at);
  return Math.acos(Math.min(1, Vector3.Dot(look.normalize(), point.subtract(at).normalize())));
}
const node = (hero, name, x, y, z) => { const n = new TransformNode(name, hero.blend.scene); n.position.set(x, y, z); n.computeWorldMatrix(true); return n; };

{
  // A target to the right, ahead: the head turns most of the way, the eyes the rest, the eyes first.
  const hero = make(), target = node(hero, 'lamp', -1.2, 1.6, 1.5);
  hero.body.play('Idle', { blend: 0 });
  hero.add(gaze({ targets: [target], stare: true }));
  run(hero, 0.1);
  const early = { eye: offBy(hero, 'LeftEye', target.position), head: offBy(hero, 'Head', target.position) };
  assert.ok(early.eye < early.head, `the eyes lead (${early.eye.toFixed(2)} < ${early.head.toFixed(2)})`);
  run(hero, 1.5);
  assert.ok(offBy(hero, 'Head', target.position) < 0.05, `the head faces it (${offBy(hero, 'Head', target.position).toFixed(3)})`);
  assert.ok(offBy(hero, 'LeftEye', target.position) < 0.05, 'the eyes on it');
}

{
  // Nearer wins; the intent's look wins over both; far behind is let go; beyond `near` is ignored.
  const hero = make(), near = node(hero, 'near', 1, 1.6, 1.5), far = node(hero, 'far', -3, 1.6, 4);
  hero.body.play('Idle', { blend: 0 });
  const handle = hero.add(gaze({ targets: [far, null, near, undefined], stare: true }));
  run(hero, 1.5);
  assert.ok(offBy(hero, 'Head', near.position) < 0.05, 'the nearer target is watched, empty entries skipped');
  const looked = new Vector3(0, 2.5, 3);
  hero.input = () => ({ move: Vector3.Zero(), look: looked });
  run(hero, 1.5);
  assert.ok(offBy(hero, 'Head', looked) < 0.05, "the intent's look wins");
  hero.input = null;
  handle.targets = [node(hero, 'behind', 0, 1.6, -3)];
  run(hero, 1.5);
  const rest = make();
  rest.body.play('Idle', { blend: 0 });
  run(rest, 3);
  const head = hero.rig.boneIndex('mixamorig:Head') * 10;
  assert.ok(Math.abs(hero.pose[head + 4] - rest.pose[head + 4]) < 0.01, 'a target far behind is let go');
  handle.targets = [node(hero, 'distant', 0, 1.6, 30)];
  run(hero, 1.5);
  assert.ok(Math.abs(hero.pose[head + 4] - rest.pose[head + 4]) < 0.01, 'a target beyond near is ignored');
}

{
  // Looking up or down is the head's: a target high above and in front tilts the head, not the chest.
  const hero = make(), plain = make(), high = node(hero, 'high', 0, 3, 2);
  for (const h of [hero, plain]) h.body.play('Idle', { blend: 0 });
  hero.add(gaze({ targets: [high], stare: true }));
  run(hero, 1.5); run(plain, 1.5);
  const tilt = (h, name) => { const m = h.poseApi.world(h.rig.boneIndex(`mixamorig:${name}`)); return Vector3.TransformNormal(Vector3.Up(), m).normalize(); };
  const chest = Math.acos(Math.min(1, Vector3.Dot(tilt(hero, 'Spine2'), tilt(plain, 'Spine2'))));
  assert.ok(chest < 0.02, `the chest keeps its pitch (${(chest * 180 / Math.PI).toFixed(1)} degrees)`);
  assert.ok(offBy(hero, 'Head', high.position) < 0.05, 'the head looks up at it');
}

{
  // Out of view: a target directly behind, or behind and to the side as a follow camera is, leaves the head within 5
  // degrees of its animated pose; one in view at the side turns the head without rolling it.
  const headOf = (h) => h.poseApi.world(h.rig.boneIndex('mixamorig:Head'));
  const between = (a, b, axis) => Math.acos(Math.min(1, Vector3.Dot(Vector3.TransformNormal(axis, a).normalize(), Vector3.TransformNormal(axis, b).normalize())));
  const plain = make();
  plain.body.play('Idle', { blend: 0 });
  run(plain, 1.5);
  for (const [x, y, z] of [[0, 1.6, -3], [-2.5, 3, -0.45], [2.5, 3, -1.5]]) {
    const hero = make();
    hero.body.play('Idle', { blend: 0 });
    hero.add(gaze({ targets: [node(hero, 'camera', x, y, z)], stare: true }));
    run(hero, 1.5);
    const off = between(headOf(hero), headOf(plain), Vector3.Forward()) * 180 / Math.PI;
    assert.ok(off < 5, `a target at ${x}, ${y}, ${z} leaves the head alone (${off.toFixed(1)} degrees)`);
  }
  const hero = make(), side = node(hero, 'side', -2, 2.5, 1.2);
  hero.body.play('Idle', { blend: 0 });
  hero.add(gaze({ targets: [side], stare: true }));
  run(hero, 1.5);
  const roll = Math.asin(Vector3.TransformNormal(Vector3.Right(), headOf(hero)).normalize().y) - Math.asin(Vector3.TransformNormal(Vector3.Right(), headOf(plain)).normalize().y);
  assert.ok(Math.abs(roll) < 0.05, `the head turns to the side without rolling (${(roll * 180 / Math.PI).toFixed(1)} degrees)`);
  assert.ok(offBy(hero, 'Head', side.position) < 0.05, 'and faces it');
}

{
  // Leaning into a jump, the spine pitched 35 degrees forward, with a target off to the side: the chest only twists
  // toward it, so its sideways bend from the hips stays within 2 degrees of the pose it was given.
  const hero = make(), bone = (n) => hero.rig.boneIndex(`mixamorig:${n}`);
  hero.body.play('Idle', { blend: 0 });
  run(hero, 0.1);
  const sideways = () => {
    const hips = hero.poseApi.world(bone('Hips')), chest = hero.poseApi.world(bone('Spine2'));
    const side = Vector3.TransformNormal(Vector3.Right(), hips).normalize(), up = Vector3.TransformNormal(Vector3.Up(), hips).normalize();
    const chestUp = Vector3.TransformNormal(Vector3.Up(), chest).normalize();
    return Math.atan2(Vector3.Dot(chestUp, side), Vector3.Dot(chestUp, up));
  };
  turnWorld(hero.poseApi, bone('Spine'), about(Vector3.Right(), 0.6, new Quaternion()));
  const before = sideways(), head = bone('Head'), eyes = ['LeftEye', 'RightEye'].map(bone);
  aimChain(hero.poseApi, ['Spine2', 'Neck', 'Head'].map(bone), [0.25, 0.25, 1], forwardIn(hero, head, eyes, head), new Vector3(-2, 1.4, 1.2), { yaw: 1.2, pitch: 0.7 }, 1);
  const bent = Math.abs(sideways() - before);
  assert.ok(bent < 2 * Math.PI / 180, `leaning, the chest bends sideways ${(bent * 180 / Math.PI).toFixed(1)} degrees toward a target at the side`);
}

{
  // Glances: the same seed, the same glances; stare holds the eyes.
  const glances = (options) => {
    const hero = make(), target = node(hero, 'lamp', 0, 1.6, 2), seen = [];
    hero.body.play('Idle', { blend: 0 });
    hero.add(gaze({ targets: [target], ...options }));
    for (let t = 0; t < 8; t += DT) { hero.update(DT); seen.push(offBy(hero, 'LeftEye', target.position)); }
    return seen;
  };
  const a = glances({}), b = glances({}), still = glances({ stare: true });
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(Math.max(...a.slice(120)) > 0.1, 'the eyes glance away now and then');
  assert.ok(Math.max(...still.slice(120)) < 0.05, 'stare holds them on the target');
}

{
  // Snow aims its eyes by moving their track targets (AIM-Eye.L damped-tracks TGT-Eye.L): the target goes onto the
  // line from the eye to the point, clamped to the eye's reach of the face.
  const snow = snowRig(), { rig, root } = snow, data = Float32Array.from(rig.rest);
  const pose = createPoseApi(data, rig.parents, () => root), i = (n) => rig.boneIndex(n);
  const eyes = [i('Eye.L'), i('Eye.R')], eye = createEye(snow, i('Eye.L'), i('FK-Head'), eyes);
  assert.equal(eye.target, i('TGT-Eye.L'), "the rig's eye target is found");
  const at = new Vector3(), aim = new Vector3();
  worldOf(pose, i('Eye.L'), at);
  const point = at.add(new Vector3(0.3, 0.05, 1));
  eye.lookAt(pose, point, 1);
  worldOf(pose, i('TGT-Eye.L'), aim);
  const along = Vector3.Dot(aim.subtract(at).normalize(), point.subtract(at).normalize());
  assert.ok(along > 0.999, `the target lies toward the point (${along})`);
}

console.log('character effects gaze: ok');
