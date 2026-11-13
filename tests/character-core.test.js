// The character animation core (runtime/character/core.js) on the basic test rig (a Mixamo-named skeleton with Idle,
// Walk, Run and Jump made in code), by the guide's rules: roles found by their Mixamo names; one clock per source
// however many layers play it; `once` ends and resolves `done`, a switch first resolves it as interrupted; a switch
// between different poses is dead blending, the pose moving on continuously; a layer's mask limits it to its roles'
// bones; an additive layer adds its action's change; `with` starts an action at another layer's time; `speed` scales
// every clock; a mix places actions on a value and eases it; mistakes throw by name.
import assert from 'node:assert/strict';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { defineSource } from '../src/io_scene_babylon/runtime/character/api.js';
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import { STRIDE, poseDistance } from '../src/io_scene_babylon/runtime/character/pose.js';

const DT = 1 / 30;
// A stand-in for a loaded scene: the basic rig's skeleton and actions, as a package gives them.
const make = () => new Character(basicBlend(), 'Armature', { manual: true, idle: false });
const run = (hero, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) hero.update(DT); };
const bone = (hero, name) => { const o = hero.rig.boneIndex(`mixamorig:${name}`) * STRIDE; return hero.pose.slice(o, o + STRIDE); };
const differ = (a, b, by = 1e-4) => a.some((v, i) => Math.abs(v - b[i]) > by);

{
  const hero = make();
  assert.equal(hero.roles.hips, 'mixamorig:Hips', 'roles by their Mixamo names');
  assert.deepEqual(hero.roles['leg.L'], ['mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:LeftFoot'], 'a leg as a chain');
  assert.equal(hero.roles['foot.L'], 'mixamorig:LeftFoot', 'its end');
  assert.throws(() => hero.action('Swim'), /No action "Swim" on Armature: it has "Idle", "Walk", "Run", "Jump"/, 'an unknown action names those there are');
  assert.throws(() => hero.layer('tail', { roles: ['tail'] }), /No role "tail"/, 'an unknown role throws');
}

{
  // One clock per source.
  const hero = make();
  const walk = hero.action('Walk');
  hero.body.play(walk, { blend: 0 });
  hero.layer('upper', { roles: ['spine'] }).play(walk, { blend: 0 });
  run(hero, 0.3);
  assert.ok(Math.abs(walk.time - 0.3) < 1e-6, `two layers advance one action's clock once a frame (${walk.time})`);
  hero.speed = 2;
  hero.update(DT);
  assert.ok(Math.abs(walk.time - 0.3 - 2 * DT) < 1e-6, 'speed 2 runs the clock twice as fast');
}

{
  // once and done; a switch resolves the one before as interrupted.
  const hero = make();
  const jump = hero.body.play('Jump', { once: true, blend: 0 });
  let result = null;
  jump.done.then((r) => { result = r; });
  run(hero, 1.3);
  await Promise.resolve();
  assert.deepEqual(result, { ended: true }, 'a once-played action resolves ended');
  const walk = hero.body.play('Walk');
  let cut = null;
  walk.done.then((r) => { cut = r; });
  hero.body.play('Run');
  await Promise.resolve();
  assert.deepEqual(cut, { interrupted: true }, 'a switch resolves the one before as interrupted');
}

{
  // Dead blending: a switch from Walk to Run moves on continuously; without a blend it jumps.
  const step = (blend) => {
    const hero = make();
    hero.body.play('Walk', { blend: 0 });
    run(hero, 0.4);
    const last = hero.pose.slice();
    hero.body.play('Run', { blend });
    hero.update(DT);
    return poseDistance(last, hero.pose).turn;
  };
  const cut = step(0), blended = step(0.3);
  assert.ok(cut > 0.1, `a cut jumps (${cut.toFixed(3)} rad)`);
  assert.ok(blended < cut / 3, `a blended switch moves on from the pose shown last (${blended.toFixed(3)} rad, cut ${cut.toFixed(3)})`);
  const hero = make();
  hero.body.play('Walk', { blend: 0 });
  run(hero, 0.4);
  hero.body.play('Run', { blend: 0.3 });
  run(hero, 0.5);
  const run2 = make();
  run2.body.play('Run', { blend: 0 });
  run(run2, 0.5);
  assert.ok(poseDistance(hero.pose, run2.pose).turn < 1e-3, 'after the blend time it is the new source');
}

{
  // Masks: a layer on the legs changes them, not the spine above.
  const hero = make();
  hero.body.play('Idle', { blend: 0 });
  hero.layer('legs', { roles: ['leg.L', 'leg.R'] }).play('Run', { blend: 0 });
  run(hero, 0.2);
  const idle = make();
  idle.body.play('Idle', { blend: 0 });
  run(idle, 0.2);
  assert.ok(differ(bone(hero, 'LeftUpLeg'), bone(idle, 'LeftUpLeg'), 1e-3), 'the legs follow their layer');
  assert.ok(!differ(bone(hero, 'Spine1'), bone(idle, 'Spine1')), 'the spine stays with the body');
}

{
  // Additive: a layer adding Walk's change from its first frame over Idle.
  const hero = make();
  hero.body.play('Idle', { blend: 0 });
  const added = hero.layer('add', { add: true, weight: 0.5 }).play('Walk', { blend: 0 });
  hero.update(0);
  const idle = make();
  idle.body.play('Idle', { blend: 0 });
  idle.update(0);
  assert.ok(poseDistance(hero.pose, idle.pose).turn < 1e-3, 'at its first frame an additive layer adds nothing');
  run(hero, 0.25);
  run(idle, 0.25);
  assert.ok(poseDistance(hero.pose, idle.pose).turn > 0.05, 'later it adds the action\'s change');
  added.weight = 0;
  hero.update(DT);
  idle.update(DT);
  assert.ok(poseDistance(hero.pose, idle.pose).turn < 1e-3, 'at weight 0 it adds nothing');
}

{
  // with: an action started at another layer's time.
  const hero = make();
  hero.body.play('Walk', { blend: 0 });
  run(hero, 0.6);
  hero.layer('arms', { roles: ['arm.L'] }).play(hero.action('Walk', { loop: 0 }), { with: hero.body });
  assert.ok(Math.abs(hero.action('Walk', { loop: 0 }).time - hero.action('Walk').time) < 1e-6, 'with: it starts at the other layer\'s time');
}

{
  // A mix places actions on a value and eases toward it.
  const hero = make();
  const gait = hero.mix({ Walk: 1.2, Run: 3.5 });
  hero.body.play(gait, { blend: 0 });
  gait.value = 3.5;
  hero.update(DT);
  assert.ok(gait.value > 1.2 && gait.value < 3.5, `a mix eases toward its value (${gait.value.toFixed(2)})`);
  run(hero, 1);
  assert.ok(gait.value > 3.49, 'and reaches it');
  const runOnly = make();
  runOnly.body.play('Run', { blend: 0 });
  runOnly.action('Run').seek(hero.action('Run').time);
  runOnly.update(0);
  assert.ok(poseDistance(hero.pose, runOnly.pose).turn < 1e-3, 'at a point it is that action');
}

{
  // A source of one's own: sample blends actions by weight; init gives its state once.
  let inits = 0;
  const gait = defineSource({
    name: 'gait',
    options: { fast: 0 },
    init: () => ({ frames: ++inits && 0 }),
    update(dt, { sample, options }, state) {
      state.frames++;
      sample('Walk', 1 - options.fast);
      sample('Run', options.fast);
    },
  });
  const hero = make(), walk = make(), source = gait({ fast: 0 });
  hero.body.play(source, { blend: 0 });
  walk.body.play('Walk', { blend: 0 });
  run(hero, 0.4);
  run(walk, 0.4);
  assert.ok(poseDistance(hero.pose, walk.pose).turn < 1e-3, 'a source sampling Walk alone poses as Walk');
  hero.body.play(source);
  assert.equal(inits, 1, 'its init ran once');
  assert.equal(hero.action('Walk').duration, 1, 'an action tells its duration');
  assert.deepEqual(hero.action('Walk').markers, [], 'and its markers');
}

{
  // Idle life is attached by default (a frozen idle reads as dead), and left out with idle: false.
  const alive = new Character(basicBlend(), 'Armature', { manual: true });
  assert.deepEqual(alive.effects.map((e) => e.effect.name).sort(), ['breathe', 'eyes'], 'breathe and eyes by default');
  assert.equal(make().effects.length, 0, 'none with idle: false');
}

{
  // Locomotion played on the body moves the legs as the character moves.
  const blend = basicBlend();
  MeshBuilder.CreateGround('Ground', { width: 100, height: 100 }, blend.scene);
  const hero = new Character(blend, 'Armature', { manual: true, idle: false });
  hero.body.play(hero.locomotion, { blend: 0 });
  const move = new Vector3(0, 0, 2);
  hero.input = () => ({ move });
  run(hero, 0.5);
  const a = bone(hero, 'LeftUpLeg');
  run(hero, 0.25);
  assert.ok(differ(a, bone(hero, 'LeftUpLeg'), 1e-3), 'locomotion on the body swings the legs while it moves');
}

{
  // An effect's handle reads its weight live: added at 0 and faded to 1, it reads 1 and applies fully.
  const hero = make();
  let applied = 0;
  const handle = hero.add({ name: 'probe', on: 'controls', needs: [], options: {}, update: () => { applied = handle.weight; } }, { weight: 0 });
  handle.fade(1, 0.2);
  run(hero, 0.5);
  assert.equal(handle.weight, 1, 'the handle reads the faded weight');
  assert.equal(hero.effect('probe').weight, 1, 'and so does a lookup by name');
  assert.equal(applied, 1, 'the effect runs at full weight');
  handle.weight = 0.25;
  assert.equal(handle.weight, 0.25, 'setting it reaches the effect');
}

console.log("Character core on the basic rig: roles, one clock per source, speed, once and done, dead blending, masks, additive, with, mixes and sources of one's own");
