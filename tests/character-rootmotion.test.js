// Root motion (runtime/character/rootmotion.js): an action played on the body moves the character by its root motion
// and the pose stays over the root, while intent waits; warpTo lands its marker on a place and facing; an action made
// in place holds the character still; locomotion takes the root back at the action's velocity.
import assert from 'node:assert/strict';
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { createClip } from '../src/io_scene_babylon/runtime/character/clip.js';
import { STRIDE } from '../src/io_scene_babylon/runtime/character/pose.js';

const DT = 1 / 60, SPEED = 1.2;

function make() {
  const blend = basicBlend();
  MeshBuilder.CreateGround('Floor', { width: 400, height: 400 }, blend.scene).computeWorldMatrix(true);
  const hero = new Character(blend, 'Armature', { manual: true });
  // A walk forward with root motion and a "Hands" marker on its 24th frame.
  const walk = hero.clips.get('Walk'), hips = hero.rig.boneIndex('mixamorig:Hips'), size = walk.bones.length * STRIDE, data = Float32Array.from(walk.data);
  for (let f = 0; f < walk.frames; f++) data[f * size + walk.bones.indexOf(hips) * STRIDE + 2] += (f / walk.fps) * SPEED;
  hero.clips.set('Vault', createClip('Vault', walk.fps, walk.bones, data, [{ name: 'Hands', frame: 24 }]));
  hero.input = () => ({ move: new Vector3(2, 0, 0) });
  return hero;
}
const run = (hero, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) hero.update(DT); };
const hipsZ = (hero) => hero.pose[hero.rig.boneIndex('mixamorig:Hips') * STRIDE + 2];

{
  const hero = make();
  hero.body.play('Vault', { once: true, blend: 0 });
  run(hero, 0.5);
  assert.equal(hero.movement.owner, 'action', 'the action owns the root');
  assert.ok(Math.abs(hero.movement.position.z - 0.5 * SPEED) < 0.03, `moved by its root motion: ${hero.movement.position.z}`);
  assert.ok(Math.abs(hero.movement.position.x) < 1e-6, `intent waits: ${hero.movement.position.x}`);
  assert.ok(Math.abs(hipsZ(hero)) < 0.05, `the hips stay over the root: ${hipsZ(hero)}`);
  run(hero, 0.3);
  hero.body.play(hero.locomotion, { blend: 0.2 });
  hero.update(DT);
  assert.equal(hero.movement.owner, 'movement', 'locomotion takes the root back');
  assert.ok(hero.movement.velocity.z > 0.8, `at the action's velocity: ${hero.movement.velocity.z}`);
}

// warpTo: the marker (0.8 s in) lands on a place 1.5 m ahead and 0.4 m right, facing right.
{
  const hero = make(), place = new Vector3(0.4, 0, 1.5), facing = new Vector3(1, 0, 0);
  hero.body.play('Vault', { once: true, blend: 0, warpTo: { marker: 'Hands', position: place, facing } });
  // Markers are told at step 3, before the root moves: the root is compared at the end of that frame.
  let passed = false, landed = null;
  hero.onMarker.add(({ name }) => { passed ||= name === 'Hands'; });
  for (let t = 0; t < 1 && !landed; t += DT) {
    hero.update(DT);
    if (passed) landed = { at: hero.movement.position.clone(), facing: hero.movement.facing.clone() };
  }
  assert.ok(landed, 'the marker passed');
  const off = Vector3.Distance(landed.at, place);
  console.log(`warpTo landed ${(100 * off).toFixed(2)} cm from its place`);
  assert.ok(off < 0.01, `landed ${(100 * off).toFixed(1)} cm from the place`);
  assert.ok(Vector3.Dot(landed.facing, facing) > Math.cos(0.05), `facing ${landed.facing}`);
  assert.throws(() => { const other = make(); other.body.play('Vault', { warpTo: { marker: 'Feet', position: place } }); other.update(DT); }, /no marker "Feet" in Vault: it has "Hands"/);
}

// An action made in place holds the character still.
{
  const hero = make();
  hero.body.play('Idle');
  run(hero, 0.5);
  assert.equal(hero.movement.owner, 'action');
  assert.ok(hero.movement.position.length() < 1e-6, 'still');
}
console.log('character rootmotion ok');
