// A rig whose armature object sits above the ground under it (its origin above its soles, as Snow's is 3.3 cm) keeps
// that height wherever it walks: the character places its authored offset over the ground, not its origin on it, and
// the feet effect takes the ground under it, not its origin, for the ground its action was made on.
import assert from 'node:assert/strict';
import { MeshBuilder, TransformNode, Vector3 } from '@babylonjs/core';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { feet } from '../src/io_scene_babylon/runtime/character/effects/index.js';
import { basicBlend } from './fixtures/basic-blend.js';

const LIFT = 0.033;
/** The mannequin on a ground with a raised floor ahead, its armature object authored LIFT above the ground. */
function make(withFeet) {
  const blend = basicBlend();
  MeshBuilder.CreateGround('Ground', { width: 100, height: 100 }, blend.scene).computeWorldMatrix(true);
  const floor = MeshBuilder.CreateBox('Floor', { width: 4, depth: 4, height: 0.2 }, blend.scene);
  floor.position.set(0, 0.1, 5);
  floor.computeWorldMatrix(true);
  // The armature object, authored above the ground (load() gives it by its ID).
  const armature = new TransformNode('Armature', blend.scene);
  armature.position.y = LIFT;
  armature.computeWorldMatrix(true);
  blend.nodeOf = (id) => (id === 'OB:Armature' ? armature : null);
  const character = new Character(blend, 'Armature', { manual: true, idle: false });
  character.body.play(character.locomotion, { blend: 0 });
  if (withFeet) character.add(feet());
  return character;
}

// Standing on flat ground, its feet are where the action puts them: the feet effect takes the ground under it for the
// ground its action was made on, so it neither lowers the hips nor reaches the feet down.
{
  const [footed, plain] = [make(true), make(false)], hipsY = (h) => h.poseApi.world(h.rig.boneIndex('mixamorig:Hips')).m[13];
  for (let k = 0; k < 60; k++) { footed.update(1 / 60); plain.update(1 / 60); }
  const lowered = hipsY(plain) - hipsY(footed);
  assert.ok(Math.abs(lowered) < 0.001, `standing, the feet effect leaves the hips where the action puts them (${(lowered * 1000).toFixed(1)} mm lower)`);
}

const hero = make(false);
const move = new Vector3(0, 0, 1.2);
hero.input = () => ({ move });
let worst = 0;
for (let k = 0; k < 300; k++) {
  hero.update(1 / 60);
  const ground = hero.movement.position.y, origin = hero.node.getAbsolutePosition().y;
  if (hero.movement.grounded) worst = Math.max(worst, Math.abs(origin - ground - LIFT));
}
assert.ok(hero.movement.position.y > 0.15, `it walked up onto the floor (ground at ${hero.movement.position.y.toFixed(3)} m)`);
assert.ok(worst < 0.005, `the origin keeps its authored ${LIFT} m over the ground, within 5 mm (worst ${(worst * 1000).toFixed(1)} mm)`);
console.log(`character authored height: a rig authored ${(LIFT * 100).toFixed(1)} cm above the ground keeps it while walking, within ${(worst * 1000).toFixed(1)} mm`);
