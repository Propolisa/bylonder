// The lean effect (runtime/character/effects/lean.js) on the basic rig under locomotion: starting to run tilts the
// chest forward, stopping tilts it back, both within the 12 degree cap, a turn tilts it into the turn, and standing still
// it eases back upright.
import assert from 'node:assert/strict';
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { lean } from '../src/io_scene_babylon/runtime/character/effects/index.js';

const DT = 1 / 60;
const make = (withLean) => {
  const blend = basicBlend();
  MeshBuilder.CreateGround('floor', { width: 200, height: 200 }, blend.scene);
  const hero = new Character(blend, 'Armature', { manual: true });
  hero.body.play(hero.locomotion, { blend: 0 });
  if (withLean) hero.add(lean());
  return hero;
};
const hero = make(true), plain = make(false);
let move = new Vector3(0, 0, 0);
for (const h of [hero, plain]) h.input = () => ({ move });
/** The chest's up axis in the character's frame (x right, z forward), less the same without lean. */
const tilt = () => {
  const up = (h) => {
    const m = h.poseApi.world(h.rig.boneIndex('mixamorig:Spine2')), y = Vector3.TransformNormal(Vector3.Up(), m).normalize();
    const f = h.movement.facing, side = Vector3.Cross(Vector3.Up(), f);
    return { forward: Vector3.Dot(y, f), side: Vector3.Dot(y, side) };
  };
  const a = up(hero), b = up(plain);
  return { forward: a.forward - b.forward, side: a.side - b.side };
};
const run = (seconds, each = () => {}) => { for (let t = 0; t < seconds; t += DT) { hero.update(DT); plain.update(DT); each(); } };

run(0.5);
move = new Vector3(0, 0, 4);
let most = 0;
run(0.4, () => { most = Math.max(most, tilt().forward); });
const CAP = Math.sin(12 * Math.PI / 180) + 0.005;
assert.ok(most > 0.05 && most < CAP, `speeding up leans forward, within the cap (${most.toFixed(3)})`);
run(2);
move = new Vector3(0, 0, 0);
let back = 0;
run(0.4, () => { back = Math.min(back, tilt().forward); });
assert.ok(back < -0.05 && back > -CAP, `stopping leans back, within the cap (${back.toFixed(3)})`);
run(2);
assert.ok(Math.abs(tilt().forward) < 0.005 && Math.abs(tilt().side) < 0.005, 'upright when still');
// A circle at 3 m/s turning from +Z toward +X: the turn's centre is on the +X side of the facing, and the chest leans there.
let into = 0, angle = 0;
run(3, () => { angle += DT * 1.5; move = new Vector3(3 * Math.sin(angle), 0, 3 * Math.cos(angle)); into += tilt().side * DT / 3; });
assert.ok(into > 0.02, `leans into the turn (${into.toFixed(3)})`);
console.log('character effects lean: ok');
