// A recorded run (docs/demos/run.js, a debug tool for the demo pages) replays to the same place: a character driven
// by a stick for a few seconds, recorded, then a fresh character fed the recording's intents and time steps ends where
// the first did, exactly.
import assert from 'node:assert/strict';
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { recordRun, replayRun } from '../docs/demos/run.js';
import { basicBlend } from './fixtures/basic-blend.js';

const made = () => {
  const blend = basicBlend();
  MeshBuilder.CreateGround('Ground', { width: 100, height: 100 }, blend.scene).computeWorldMatrix(true);
  const hero = new Character(blend, 'Armature', { manual: true });
  hero.body.play(hero.locomotion, { blend: 0 });
  return hero;
};
const first = made(), run = recordRun(first, 'test');
let t = 0;
first.input = () => ({ move: new Vector3(Math.sin(t), 0, 1.2 + Math.cos(t * 0.7)), ...(t > 1.5 && t < 1.55 && { jump: true }) });
for (let k = 0; k < 240; k++) { const dt = k % 3 ? 1 / 60 : 1 / 45; first.update(dt); t += dt; }
const recorded = JSON.parse(JSON.stringify(run.toJSON()));
const second = made(), replay = replayRun(second, recorded);
while (replay.step());
assert.deepEqual([second.movement.position.x, second.movement.position.y, second.movement.position.z], [first.movement.position.x, first.movement.position.y, first.movement.position.z],
  'the replay ends where the recording did, exactly');
assert.ok(first.movement.position.length() > 1, 'after moving');
console.log('character run replay: a recorded run replays to the same final position, exactly');
