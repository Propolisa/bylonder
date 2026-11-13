// The basic path on a real Mixamo-style character (examples/basic-character: Quaternius' mannequin with its own Idle,
// Walk, Run and Jump, no markers or root motion), exported as File > Export > JavaScript does: roles found by name,
// each action's contacts found at load (two per cycle in the gaits, a flight in the jump), its gait speeds from them,
// and locomotion walking it with the planted foot still.
import assert from 'node:assert/strict';
import { NullEngine, Vector3, MeshBuilder } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { flight } from '../src/io_scene_babylon/runtime/character/contacts.js';
import { createWorldPose } from '../src/io_scene_babylon/runtime/character/procedural.js';

const { world } = openExample('basic-character');
const written = writePackage(await exportModule(world, { animations: 'CLIPS' }));
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const DT = 1 / 60;
const hero = new Character(blend, 'Armature', { manual: true });
assert.deepEqual(hero.roles['leg.L'], ['DEF-thigh.L', 'DEF-shin.L', 'DEF-foot.L'], 'legs by the DEF- names');
// Found at export from Blender's evaluation of the deform feet; in Blender the planted toes slide at 1.05 (left) and
// 1.13 m/s (right) in Walk, 5.9 m/s in Run (Jog_Fwd_Loop).
const exported = blend.ir.scene.time.clips;
for (const [name, truth] of [['Walk', 1.09], ['Run', 5.9]]) {
  const { contacts } = exported[name];
  assert.deepEqual(contacts.legs.map((leg) => leg.foot), ['DEF-foot.L', 'DEF-foot.R'], `${name}: the deform feet, in the legs' order`);
  assert.ok(Math.abs(contacts.speed - truth) < 0.02 * truth, `${name}: exported speed ${contacts.speed.toFixed(2)} m/s, Blender's ${truth}`);
  assert.equal(hero.action(name).contacts.speed, contacts.speed, `${name}: the page reads the export's contacts`);
}
const starts = (down) => down.reduce((n, d, f) => n + (d && !down[(f - 1 + down.length) % down.length] ? 1 : 0), 0);
for (const name of ['Walk', 'Run']) {
  const { contacts } = hero.action(name);
  assert.deepEqual(contacts.down.map(starts), [1, 1], `${name}: one contact per foot per cycle`);
  console.log(`${name}: ${contacts.speed.toFixed(2)} m/s`);
}
const { walk, run } = { walk: hero.action('Walk').contacts.speed, run: hero.action('Run').contacts.speed };
assert.ok(walk > 0.8 && walk < 2 && run > walk * 1.5 && run < 6, `gait speeds: walk ${walk}, run ${run}`);
const air = flight(hero.action('Jump').contacts);
assert.ok(air && air[1] - air[0] > 0.3, `the jump's flight: ${air}`);

MeshBuilder.CreateGround('Floor', { width: 400, height: 400 }, blend.scene).computeWorldMatrix(true);
hero.body.play(hero.locomotion, { blend: 0 });
hero.input = () => ({ move: new Vector3(0, 0, walk) });
// The ball of the foot (the toe's head) while it is on the ground, from when it lands to when it lifts: how far it drifts
// over that contact, the body moving on at the walk's speed.
const ball = hero.rig.boneIndex('DEF-toe.L'), posed = createWorldPose(hero.rig);
let drift = 0, from = null;
for (let t = 0; t < 4; t += DT) {
  hero.update(DT);
  hero.rig.rootWorld(posed.root);
  posed.update(hero.pose);
  const at = posed.position.slice(ball * 3, ball * 3 + 3), down = hero.contact('foot.L') > 0.999 && at[1] < 0.03;
  if (!down) from = null;
  else if (!from) from = at;
  else if (t > 1) drift = Math.max(drift, Math.hypot(at[0] - from[0], at[2] - from[2]));
}
console.log(`walking, the planted left foot's ball drifts at most ${(100 * drift).toFixed(1)} cm over a contact`);
assert.ok(drift < 0.03, 'planted foot nearly still');
hero.dispose();
blend.dispose();
written.remove();
console.log('basic character: roles, contacts, gait speeds and a planted walk');
process.exit(0);
