// A character from an exported package (the Rigged Character with its action): `new Character(blend, 'Rig')` finds
// the armature's skeleton and actions, roles by the metarig's names, takes the rig off the page's timeline, and its
// body plays the action onto the skeleton's bones.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { STRIDE } from '../src/io_scene_babylon/runtime/character/pose.js';

const { world } = openExample('rigged-character');
const written = writePackage(await exportModule(world, { animations: 'BOTH' }));
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const DT = 1 / 30;
const hero = new Character(blend, 'Rig', { manual: true });
assert.equal(hero.roles.hips, 'spine', 'roles by the metarig\'s names: its spine is the hips');
assert.deepEqual(hero.roles['arm.L'], ['upper_arm.L', 'forearm.L', 'hand.L'], 'and the arms as chains');
assert.throws(() => hero.action('Walk'), /No action "Walk" on Rig: it has "RigAction"/, 'an unknown action names those there are');
const skeleton = blend.scene.skeletons.find((s) => s.id === 'Rig');
assert.ok(blend.scene.animationGroups.filter((g) => g.targetedAnimations.some((t) => t.target.getSkeleton?.() === skeleton)).every((g) => !g.isPlaying), 'the rig\'s own clips are stopped');

hero.body.play('RigAction', { blend: 0 });
hero.update(0);
const hand = hero.rig.boneIndex('hand_ik.L'), start = hero.pose.slice(hand * STRIDE, hand * STRIDE + STRIDE);
for (let k = 0; k < 45; k++) hero.update(DT);
assert.ok(hero.pose.slice(hand * STRIDE, hand * STRIDE + STRIDE).some((v, i) => Math.abs(v - start[i]) > 1e-4), 'the body plays the action');
const local = skeleton.bones.find((b) => b.name === 'hand_ik.L').getLocalMatrix().getTranslation();
assert.ok(Math.abs(local.x - hero.pose[hand * STRIDE]) < 1e-5 && Math.abs(local.y - hero.pose[hand * STRIDE + 1]) < 1e-5, 'onto the skeleton\'s bone');

// bone(): a node that follows the bone as drawn; debug.who: what moves a bone.
const follower = hero.bone('hand.L');
assert.equal(hero.bone('hand.L'), follower, 'one node per bone');
const drawn = () => {
  blend.scene.render();
  const mesh = blend.scene.meshes.find((m) => m.skeleton === skeleton), b = skeleton.bones.find((x) => x.name === hero.roles['hand.L']);
  return [follower.getAbsolutePosition().clone(), b.getAbsolutePosition(mesh)];
};
for (let k = 0; k < 10; k++) hero.update(DT);
const [at, bone] = drawn();
assert.ok(at.subtract(bone).length() < 1e-3, `the node is where the bone is drawn (${at} vs ${bone})`);
assert.throws(() => hero.bone('wing.L'), /No bone or role "wing.L" on Rig/, 'an unknown role or bone names the roles');
assert.deepEqual(hero.debug.who('hand.L').map((w) => w.by), ['body', 'breathe'].filter((n) => n === 'body' || hero.effects.some((e) => e.effect.name === n && Object.values(e.entry.roles).flat(3).includes(skeleton.bones.findIndex((x) => x.name === hero.roles['hand.L'])))), 'the body moves the hand');
hero.debug.show = true;
assert.ok(hero.debug.show, 'the skeleton is drawn');
hero.debug.show = false;

hero.dispose();
blend.dispose();
written.remove();
console.log('Character from a package: the armature\'s skeleton, actions and roles, off the timeline, its body posing the bones');
process.exit(0);
