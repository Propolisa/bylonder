// The springs effect (runtime/character/effects/springs.js) on the basic rig, its left arm as the swinging chain: a
// sudden start makes the arm lag, standing still it settles back onto the played pose (without gravity) or a little
// below it (with gravity); on tier C only the first bone swings; an unknown bone throws.
import assert from 'node:assert/strict';
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { springs } from '../src/io_scene_babylon/runtime/character/effects/index.js';
import { worldOf } from '../src/io_scene_babylon/runtime/character/effects/space.js';

const DT = 1 / 60, ARM = ['mixamorig:LeftArm', 'mixamorig:LeftForeArm'];
const make = (options) => {
  const blend = basicBlend();
  MeshBuilder.CreateGround('floor', { width: 200, height: 200 }, blend.scene);
  const hero = new Character(blend, 'Armature', { manual: true });
  hero.body.play(hero.locomotion, { blend: 0 });
  if (options) hero.add(springs({ bones: ARM, ...options }));
  return hero;
};
const hand = (h) => { const v = new Vector3(); worldOf(h.poseApi, h.rig.boneIndex('mixamorig:LeftHand'), v); return v; };
const pair = (options) => {
  const hero = make(options), plain = make(null);
  let move = Vector3.Zero();
  for (const h of [hero, plain]) h.input = () => ({ move });
  return { hero, plain, set: (v) => { move = v; }, run: (s, each = () => {}) => { for (let t = 0; t < s; t += DT) { hero.update(DT); plain.update(DT); each(); } } };
};

{
  const { hero, plain, set, run } = pair({ gravity: 0 });
  run(0.5);
  set(new Vector3(0, 0, 4));
  let lag = 0;
  run(0.3, () => { lag = Math.max(lag, Vector3.Distance(hand(hero), hand(plain))); });
  assert.ok(lag > 0.03, `the arm lags a sudden start (${lag.toFixed(3)} m)`);
  set(Vector3.Zero());
  run(4);
  assert.ok(Vector3.Distance(hand(hero), hand(plain)) < 2e-3, `settles on the pose (${Vector3.Distance(hand(hero), hand(plain)).toFixed(4)} m)`);
}

{
  const { hero, plain, run } = pair({ gravity: 9.81 });
  run(3);
  const sag = hand(plain).y - hand(hero).y;
  assert.ok(sag > 0.005 && sag < 0.2, `gravity sags it a little (${sag.toFixed(3)} m)`);
}

{
  const tier = Character.tier;
  Character.tier = 'C';
  const { hero, plain, run } = pair({ gravity: 9.81 });
  run(2);
  const o = hero.rig.boneIndex('mixamorig:LeftForeArm') * 10, same = [3, 4, 5, 6].every((k) => Math.abs(hero.pose[o + k] - plain.pose[o + k]) < 1e-6);
  assert.ok(same, 'tier C: the forearm keeps its pose');
  Character.tier = tier;
}

{
  assert.throws(() => make({ bones: ['Ponytail'] }), /springs: no bone "Ponytail" on Armature/);
}

console.log('character effects springs: ok');
