// The reach effect (runtime/character/effects/reach.js) on the basic rig: a hand eases onto a point in reach and
// `reached` resolves true; toward a point out of reach the arm stops at full extension pointing at it and `reached`
// resolves false; an unknown hand throws naming those there are.
import assert from 'node:assert/strict';
import { TransformNode, Vector3 } from '@babylonjs/core';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { reach } from '../src/io_scene_babylon/runtime/character/effects/index.js';
import { worldOf } from '../src/io_scene_babylon/runtime/character/effects/space.js';

const DT = 1 / 60;
const make = () => { const hero = new Character(basicBlend(), 'Armature', { manual: true, idle: false }); hero.body.play('Idle', { blend: 0 }); return hero; };
const at = (hero, name) => { const v = new Vector3(); worldOf(hero.poseApi, hero.rig.boneIndex(`mixamorig:${name}`), v); return v; };
const settle = async (hero, grab) => {
  let result = null;
  grab.reached.then((r) => { result = r; });
  for (let t = 0; t < 2 && result === null; t += DT) { hero.update(DT); await Promise.resolve(); }
  return result;
};

{
  const hero = make(), cup = new TransformNode('cup', hero.blend.scene);
  cup.position.set(-0.35, 1.2, 0.35);
  cup.computeWorldMatrix(true);
  const grab = hero.add(reach({ hand: 'hand.R', target: cup }));
  hero.update(DT);
  assert.ok(Vector3.Distance(at(hero, 'RightHand'), cup.position) > 0.05, 'the hand eases there, not at once');
  assert.equal(await settle(hero, grab), true, 'reached in reach');
  assert.ok(Vector3.Distance(at(hero, 'RightHand'), cup.position) < 0.01, `the hand on the cup (${at(hero, 'RightHand')})`);
}

{
  const hero = make(), far = new Vector3(-2, 1.3, 1);
  const grab = hero.add(reach({ hand: 'hand.R', target: far }));
  assert.equal(await settle(hero, grab), false, 'not reached out of reach');
  const shoulder = at(hero, 'RightArm'), hand = at(hero, 'RightHand');
  assert.ok(Math.abs(Vector3.Distance(shoulder, hand) - 0.53) < 2e-3, `full extension (${Vector3.Distance(shoulder, hand).toFixed(3)} m)`);
  const toward = Vector3.Dot(hand.subtract(shoulder).normalize(), far.subtract(shoulder).normalize());
  assert.ok(toward > 0.999, `pointing at it (${toward})`);
}

{
  const hero = make();
  assert.throws(() => hero.add(reach({ hand: 'hand.X', target: Vector3.Zero() })), /reach: no hand "hand.X" on Armature: it has hand.L, hand.R/, 'an unknown hand is named');
}

console.log('character effects reach: ok');
