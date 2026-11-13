// The feet effect (runtime/character/effects/feet.js) on the basic rig: walking faster than the action, a planted foot
// holds where it landed as far as its knee stays within `give` of the action's bend either way (backing away too), its
// hips at the action's height; on a step under one foot that foot rises onto it and the other stays down; at weight 0
// it changes nothing; through starts and stops a planted foot never jumps; a jump stretches neither leg nor waist; a
// rig without the roles it needs throws naming them.
import assert from 'node:assert/strict';
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { feet } from '../src/io_scene_babylon/runtime/character/effects/index.js';
import { worldOf } from '../src/io_scene_babylon/runtime/character/effects/space.js';

const DT = 1 / 60;
const make = (blend = basicBlend()) => new Character(blend, 'Armature', { manual: true });
const at = (hero, side) => { const v = new Vector3(); worldOf(hero.poseApi, hero.rig.boneIndex(`mixamorig:${side}Foot`), v); return v; };

/** The basic rig walking at `speed` m/s on a floor (backwards, facing ahead, when `speed` is negative), with or without the feet effect. */
function walker(withFeet, speed) {
  const blend = basicBlend();
  MeshBuilder.CreateGround('floor', { width: 400, height: 400 }, blend.scene).computeWorldMatrix(true);
  const hero = new Character(blend, 'Armature', { manual: true, idle: false }), move = new Vector3(0, 0, speed);
  hero.body.play(hero.locomotion, { blend: 0 });
  if (withFeet) hero.add(feet());
  const facing = new Vector3(0, 0, 1);
  hero.input = () => ({ move, facing });
  return hero;
}
/** The left knee's bend in radians (0 straight). */
const kneeBend = (hero) => {
  const [hip, knee] = ['LeftUpLeg', 'LeftLeg'].map((n) => { const v = new Vector3(); worldOf(hero.poseApi, hero.rig.boneIndex(`mixamorig:${n}`), v); return v; });
  const thigh = knee.subtract(hip), shin = at(hero, 'Left').subtract(knee);
  return Math.acos(Math.min(1, Vector3.Dot(thigh.normalize(), shin.normalize())));
};

/**
 * Walking: the most a planted foot moves over the ground, and the most the knee is straighter than the action's (the
 * same walk without the effect), at a speed off the walk's own so the action's foot slides.
 */
function walk(speed) {
  const hero = walker(true, speed), plain = walker(false, speed), hips = hero.rig.boneIndex('mixamorig:Hips');
  let slid = 0, held = 0, stretch = 0, folded = 0, dropped = 0, planted = null;
  for (let t = 0; t < 3; t += DT) {
    hero.update(DT); plain.update(DT);
    dropped = Math.max(dropped, Math.abs(hero.poseApi.world(hips).m[13] - plain.poseApi.world(hips).m[13]));
    stretch = Math.max(stretch, kneeBend(plain) - kneeBend(hero));
    folded = Math.max(folded, kneeBend(hero) - kneeBend(plain));
    const down = hero.contact('foot.L') > 0.99 && t > 1;
    if (!down) { planted = null; continue; }
    const p = at(hero, 'Left'), q = at(plain, 'Left');
    planted ??= [p.clone(), q.clone()];
    held = Math.max(held, Math.hypot(p.x - planted[0].x, p.z - planted[0].z));
    slid = Math.max(slid, Math.hypot(q.x - planted[1].x, q.z - planted[1].z));
  }
  return { slid, held, stretch, folded, dropped };
}
{
  const { slid, held, stretch, dropped } = walk(2);
  assert.ok(slid > 0.03, `without feet a planted foot slides (${slid.toFixed(3)} m)`);
  assert.ok(held < slid / 3, `with feet it slips less (${held.toFixed(3)} m, ${slid.toFixed(3)} m without)`);
  assert.ok(dropped < 0.001, `on flat ground the hips stay at the action's height (${(dropped * 1000).toFixed(1)} mm off)`);
  assert.ok(stretch < feet().options.give + 0.01, `and the knee is never straighter than the action's by more than give (${(stretch * 180 / Math.PI).toFixed(1)} degrees)`);
}
{
  // Backing away, a held foot ends up nearer the hips than the action has it: the knee still bends at most `give` more.
  const { folded } = walk(-1.2);
  assert.ok(folded < feet().options.give + 0.01, `backing away, the knee is never more bent than the action's by more than give (${(folded * 180 / Math.PI).toFixed(1)} degrees)`);
}

{
  // A 15 cm step under the right foot.
  const blend = basicBlend();
  const step = MeshBuilder.CreateBox('step', { width: 0.3, height: 0.15, depth: 1 }, blend.scene);
  step.position.set(-0.25, 0.075, 0);
  step.computeWorldMatrix(true);
  MeshBuilder.CreateGround('floor', { width: 10, height: 10 }, blend.scene);
  const hero = make(blend), flat = make();
  for (const h of [hero, flat]) h.body.play('Idle', { blend: 0 });
  hero.add(feet());
  for (let t = 0; t < 1; t += DT) { hero.update(DT); flat.update(DT); }
  const right = at(hero, 'Right').y - at(flat, 'Right').y, left = at(hero, 'Left').y - at(flat, 'Left').y;
  assert.ok(Math.abs(right - 0.15) < 0.01, `the right foot rises onto the step (${right.toFixed(3)})`);
  assert.ok(Math.abs(left) < 0.01, `the left foot stays on the floor (${left.toFixed(3)})`);
}

{
  // At weight 0 nothing changes.
  const hero = make(), plain = make();
  for (const h of [hero, plain]) { h.input = () => ({ move: new Vector3(0, 0, 1) }); h.body.play('Walk', { blend: 0 }); }
  hero.add(feet(), { weight: 0 });
  for (let t = 0; t < 1; t += DT) { hero.update(DT); plain.update(DT); }
  const most = hero.pose.reduce((m, v, i) => Math.max(m, Math.abs(v - plain.pose[i])), 0);
  assert.ok(most < 1e-6, `weight 0 leaves the pose (${most})`);
}

{
  const hero = make();
  hero.roles = { ...hero.roles, legs: undefined };
  assert.throws(() => hero.add(feet()), /feet needs the role "legs"/, 'a missing role is named');
}

{
  // Under locomotion through a start, a stop and a walk-off: a foot with full contact never moves more in a frame than
  // the same foot without the effect plus how far the body moved (a held foot slides when the knee rule drags it, slower
  // than the body; it never jumps, and it is let go eased).
  const make2 = (withFeet) => {
    const blend = basicBlend();
    MeshBuilder.CreateGround('floor', { width: 400, height: 400 }, blend.scene).computeWorldMatrix(true);
    const hero = new Character(blend, 'Armature', { manual: true, idle: false });
    hero.body.play(hero.locomotion, { blend: 0 });
    if (withFeet) hero.add(feet());
    return hero;
  };
  const hero = make2(true), plain = make2(false);
  let move = Vector3.Zero(), worst = 0;
  for (const h of [hero, plain]) h.input = () => ({ move });
  const step = (h, side, before) => { const now = at(h, side), d = Math.hypot(now.x - before.x, now.z - before.z); before.copyFrom(now); return d; };
  for (const h of [hero, plain]) h.update(DT);
  const before = [hero, plain].map((h) => [at(h, 'Left'), at(h, 'Right')]);
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += DT) {
      hero.update(DT); plain.update(DT);
      ['Left', 'Right'].forEach((side, k) => {
        const moved = step(hero, side, before[0][k]), played = step(plain, side, before[1][k]);
        if (hero.contact(k ? 'foot.R' : 'foot.L') > 0.999) worst = Math.max(worst, moved - played - hero.movement.velocity.length() * DT);
      });
    }
  };
  run(0.5);
  move = new Vector3(0, 0, 1.2); run(2.5);
  move = Vector3.Zero(); run(1.5);
  move = new Vector3(-1.2, 0, 0); run(2);
  assert.ok(worst < 0.001, `no planted foot jumps: at most ${(worst * 1000).toFixed(1)} mm a frame beyond what is played and the body's move`);
}

{
  // No bone ever becomes NaN: walking, starting and stopping on flat ground, up and down a 12 degree slope, and with
  // no ground at all (the ground's hit is a plain { height, normal: { x, y, z } }).
  for (const ground of ['flat', 'slope', 'none']) {
    const blend = basicBlend();
    if (ground !== 'none') MeshBuilder.CreateGround('floor', { width: 400, height: 400 }, blend.scene).computeWorldMatrix(true);
    if (ground === 'slope') {
      const ramp = MeshBuilder.CreateBox('ramp', { width: 4, height: 0.2, depth: 12 }, blend.scene);
      ramp.position.set(0, 0.6, 6);
      ramp.rotation.x = -12 * Math.PI / 180;
      ramp.computeWorldMatrix(true);
    }
    const hero = new Character(blend, 'Armature', { manual: true, idle: false });
    hero.body.play(hero.locomotion, { blend: 0 });
    hero.add(feet());
    let move = Vector3.Zero(), bad = -1;
    hero.input = () => ({ move });
    for (const [seconds, z] of [[0.5, 0], [4, 1.2], [1.5, 0], [3, -1.2], [1, 0]]) {
      move = new Vector3(0, 0, z);
      for (let t = 0; t < seconds && bad < 0; t += DT) { hero.update(DT); bad = hero.pose.findIndex(Number.isNaN); }
    }
    assert.equal(bad, -1, `${ground}: no NaN in the pose${bad >= 0 ? ` (${hero.rig.names[Math.floor(bad / 10)]})` : ''}`);
  }
}

{
  // A jump, from standing and while running: in the air nothing reaches for the ground or holds a foot, so from the
  // takeoff to the landing the hips-to-foot lengths stay within 1 cm of those the action plays, and the hips-to-chest
  // length at all times (on the ground a held foot may straighten its knee by `give`).
  const length = (hero, from, to) => { const [a, b] = [from, to].map((n) => { const v = new Vector3(); worldOf(hero.poseApi, hero.rig.boneIndex(`mixamorig:${n}`), v); return v; }); return Vector3.Distance(a, b); };
  for (const speed of [0, 3]) {
    const [hero, plain] = [true, false].map((withFeet) => walker(withFeet, speed));
    let jump = false, worst = 0, waist = 0, airborne = 0;
    for (const h of [hero, plain]) { const move = new Vector3(0, 0, speed), facing = new Vector3(0, 0, 1); h.input = () => ({ move, facing, jump }); }
    for (let t = 0; t < 3; t += DT) {
      jump = t > 1 && t < 1.05;
      hero.update(DT); plain.update(DT);
      waist = Math.max(waist, Math.abs(length(hero, 'Hips', 'Spine2') - length(plain, 'Hips', 'Spine2')));
      if (hero.movement.grounded) continue;
      airborne++;
      for (const foot of ['LeftFoot', 'RightFoot']) worst = Math.max(worst, length(hero, 'Hips', foot) - length(plain, 'Hips', foot));
    }
    assert.ok(airborne > 20, `it jumped (${airborne} frames in the air)`);
    assert.ok(worst < 0.01, `at ${speed} m/s a jump stretches a leg at most ${(worst * 100).toFixed(1)} cm past the action`);
    assert.ok(waist < 0.01, `at ${speed} m/s the waist keeps the action's length (${(waist * 100).toFixed(1)} cm off)`);
  }
}

{
  // On a rig whose hips and spine hang side by side from a torso (Rigify's), a foot reaching down off a step lowers
  // the whole body: the hips-to-chest length stays within 1 cm of the action's.
  const point = (hero, name) => { const v = new Vector3(); worldOf(hero.poseApi, hero.rig.boneIndex(name), v); return v; };
  const [hero, plain] = [true, false].map((withFeet) => {
    const blend = basicBlend({ torso: true });
    MeshBuilder.CreateGround('floor', { width: 40, height: 40 }, blend.scene).computeWorldMatrix(true);
    const step = MeshBuilder.CreateBox('step', { width: 4, height: 0.2, depth: 4 }, blend.scene);
    step.position.set(2, 0.1, 0);
    step.computeWorldMatrix(true);
    const h = new Character(blend, 'Armature', { manual: true, idle: false });
    h.body.play(h.locomotion, { blend: 0 });
    if (withFeet) h.add(feet());
    h.movement.place(new Vector3(0.05, 0.2, 0), new Vector3(0, 0, 1), 0);
    h.input = () => ({ move: Vector3.Zero() });
    return h;
  });
  let waist = 0;
  for (let t = 0; t < 1; t += DT) {
    hero.update(DT); plain.update(DT);
    const length = (h) => Vector3.Distance(point(h, 'mixamorig:Hips'), point(h, 'mixamorig:Spine2'));
    waist = Math.max(waist, Math.abs(length(hero) - length(plain)));
  }
  const lowered = point(plain, 'mixamorig:Hips').y - point(hero, 'mixamorig:Hips').y;
  assert.ok(lowered > 0.05, `a foot off the step lowers the body (${(lowered * 100).toFixed(1)} cm)`);
  assert.ok(waist < 0.01, `the waist keeps the action's length as the body lowers (${(waist * 100).toFixed(1)} cm off)`);
}

console.log('character effects feet: ok');
