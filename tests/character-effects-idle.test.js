// Idle life (runtime/character/effects/breathe.js and eyes.js): breathe turns the chest back and forth at its rate and
// leaves a voiced chest alone; eyes makes small saccades the same way for the same seed and, on Snow's lid controls,
// blinks by moving the upper lid most of the way to the lower; without lids it says so once.
import assert from 'node:assert/strict';
import { Matrix, Vector3 } from '@babylonjs/core';
import { basicBlend } from './fixtures/basic-blend.js';
import { snowRig } from './fixtures/snow-rig.js';
import { Character, random } from '../src/io_scene_babylon/runtime/character/core.js';
import { breathe, eyes } from '../src/io_scene_babylon/runtime/character/effects/index.js';
import { createPoseApi } from '../src/io_scene_babylon/runtime/character/pose-api.js';
import { worldOf } from '../src/io_scene_babylon/runtime/character/effects/space.js';

const DT = 1 / 60;
const make = (seed = 1) => { const h = new Character(basicBlend(), 'Armature', { manual: true, seed, idle: false }); h.body.play('Idle', { blend: 0 }); return h; };
const turn = (a, b, name) => { const o = a.rig.boneIndex(`mixamorig:${name}`) * 10; return Math.hypot(...[3, 4, 5].map((k) => a.pose[o + k] - b.pose[o + k])) * 2; };

{
  const hero = make(), plain = make();
  hero.add(breathe());
  let most = 0, sign = 0, flips = 0;
  for (let t = 0; t < 8; t += DT) {
    hero.update(DT); plain.update(DT);
    const o = hero.rig.boneIndex('mixamorig:Spine2') * 10, d = Math.sign(hero.pose[o + 3] - plain.pose[o + 3]);
    if (d && d !== sign) { flips++; sign = d; }
    most = Math.max(most, turn(hero, plain, 'Spine2'));
  }
  assert.ok(Math.abs(most - 0.02) < 0.002, `the chest turns 0.02 rad (${most.toFixed(4)})`);
  assert.ok(flips >= 3 && flips <= 5, `two breaths in 8 s (${flips} flips)`);
  hero.voiced = () => true;
  hero.update(DT); plain.update(DT);
  assert.ok(turn(hero, plain, 'Spine2') < 1e-6, 'a voiced chest is left alone');
}

{
  const notes = [], info = console.info;
  console.info = (m) => notes.push(m);
  const run = (seed) => { const hero = make(seed), plain = make(seed); hero.add(eyes()); const seen = []; for (let t = 0; t < 4; t += DT) { hero.update(DT); plain.update(DT); seen.push(turn(hero, plain, 'LeftEye')); } return seen; };
  const a = run(1), b = run(1), c = run(2);
  console.info = info;
  assert.deepEqual(a, b, 'the same seed, the same saccades');
  assert.notDeepEqual(a, c, 'another seed, others');
  assert.ok(Math.max(...a) > 0.005 && Math.max(...a) < 0.12, `small saccades (${Math.max(...a).toFixed(3)} rad)`);
  assert.ok(new Set(a.map((v) => v.toFixed(5))).size > 3, 'that change now and then');
  assert.ok(notes.length === 3 && /no lid roles/.test(notes[0]), 'without lids it says so once per character');
}

{
  // Snow: a blink closes the upper lid control 80% of the way to the lower.
  const snow = snowRig(), { rig } = snow, data = Float32Array.from(rig.rest), root = Matrix.Identity();
  const pose = createPoseApi(data, rig.parents, () => root), index = (n) => (Array.isArray(n) ? n.map(index) : rig.boneIndex(n));
  const character = { ...snow, boneRoles: () => Object.fromEntries(Object.entries(snow.roles).map(([k, v]) => [k, index(v)])), random: random(3), voiced: () => false };
  const effect = eyes({ blinkEvery: 1 }), state = effect.init(character, {}, effect.options);
  const upper = rig.boneIndex('MSTR-Eyelid_Upper.L'), lower = rig.boneIndex('MSTR-Eyelid_Lower.L'), at = (b) => { const v = new Vector3(); worldOf(pose, b, v); return v; };
  const gap = Vector3.Distance(at(upper), at(lower));
  let shut = 0;
  for (let t = 0; t < 6; t += DT) {
    data.set(rig.rest);
    effect.update(DT, { pose, roles: {}, time: t, options: effect.options, character }, state);
    shut = Math.max(shut, 1 - Vector3.Distance(at(upper), at(lower)) / gap);
  }
  assert.ok(Math.abs(shut - 1) < 0.05, `the lids close at the blink (${shut.toFixed(3)})`);
}

console.log('character effects idle: ok');
