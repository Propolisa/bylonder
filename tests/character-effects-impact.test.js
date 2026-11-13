// The impact effect (runtime/character/effects/impact.js) on the basic rig: a hit on the chest turns it and the spine
// below it away from the blow, less at each joint down, and every offset decays back to the played pose; fifty hits
// in a row saturate below the limits (20 degrees of swing on the spine, 10 of twist) without wrapping; on tier C
// only the hit bone reacts; a large hit shoves the character under locomotion; an unknown bone throws.
import assert from 'node:assert/strict';
import { MeshBuilder, Quaternion, Vector3 } from '@babylonjs/core';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { impact } from '../src/io_scene_babylon/runtime/character/effects/index.js';
import { STRIDE, poseDistance } from '../src/io_scene_babylon/runtime/character/pose.js';

const DT = 1 / 60;
const make = () => { const hero = new Character(basicBlend(), 'Armature', { manual: true }); hero.body.play('Idle', { blend: 0 }); return hero; };
const run = (heroes, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) for (const h of heroes) h.update(DT); };
/** A bone's offset from the same bone of `plain`, in radians. */
const offset = (hero, plain, name) => {
  const o = hero.rig.boneIndex(`mixamorig:${name}`) * STRIDE, q = (p) => new Quaternion(p[o + 3], p[o + 4], p[o + 5], p[o + 6]);
  return 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(q(hero.pose), q(plain.pose)))));
};
const blow = (hero, size) => {
  const chest = hero.poseApi.world(hero.rig.boneIndex('mixamorig:Spine2')).getTranslation();
  return { bone: 'chest', at: chest.add(new Vector3(0.15, 0.1, 0.1)), impulse: new Vector3(0, 0, -size) };
};

{
  const hero = make(), plain = make(), hits = hero.add(impact());
  run([hero, plain], 0.2);
  hits.hit(blow(hero, 5));
  let chest = 0, spine = 0, hips = 0;
  for (let t = 0; t < 0.4; t += DT) {
    run([hero, plain], DT);
    chest = Math.max(chest, offset(hero, plain, 'Spine2')); spine = Math.max(spine, offset(hero, plain, 'Spine')); hips = Math.max(hips, offset(hero, plain, 'Hips'));
  }
  assert.ok(chest > 0.02, `the chest turns (${chest.toFixed(3)})`);
  assert.ok(spine > 0.002 && spine < chest, `the spine less (${spine.toFixed(3)} < ${chest.toFixed(3)})`);
  assert.ok(hips < chest, `the hips least (${hips.toFixed(3)})`);
  run([hero, plain], 2);
  assert.ok(poseDistance(hero.pose, plain.pose).turn < 1e-3, 'back to the played pose');
}

{
  const hero = make(), plain = make(), hits = hero.add(impact());
  run([hero, plain], 0.2);
  let most = 0, twist = 0;
  for (let k = 0; k < 50; k++) {
    hits.hit(blow(hero, 6));
    hits.hit({ bone: 'chest', at: blow(hero, 0).at, impulse: new Vector3(-5, 0, 0) });
    run([hero, plain], 0.05);
    most = Math.max(most, offset(hero, plain, 'Spine2'));
    const o = hero.rig.boneIndex('mixamorig:Spine2') * STRIDE, p = plain.pose, h = hero.pose;
    const d = Quaternion.Inverse(new Quaternion(p[o + 3], p[o + 4], p[o + 5], p[o + 6])).multiply(new Quaternion(h[o + 3], h[o + 4], h[o + 5], h[o + 6]));
    twist = Math.max(twist, Math.abs(2 * Math.atan2(d.y, d.w)));
  }
  assert.ok(most < (20 + 10.5) * Math.PI / 180, `saturates within swing and twist (${(most * 180 / Math.PI).toFixed(1)} deg)`);
  assert.ok(most > 10 * Math.PI / 180, `but reacts strongly (${(most * 180 / Math.PI).toFixed(1)} deg)`);
  assert.ok(twist <= 10.01 * Math.PI / 180, `twist within 10 degrees (${(twist * 180 / Math.PI).toFixed(2)})`);
  run([hero, plain], 3);
  assert.ok(poseDistance(hero.pose, plain.pose).turn < 1e-3, 'still decays back');
}

{
  const { Character: C } = await import('../src/io_scene_babylon/runtime/character/core.js');
  const tier = C.tier;
  C.tier = 'C';
  const hero = make(), plain = make(), hits = hero.add(impact());
  run([hero, plain], 0.2);
  hits.hit(blow(hero, 5));
  run([hero, plain], 0.1);
  assert.ok(offset(hero, plain, 'Spine2') > 0.01 && offset(hero, plain, 'Spine1') < 1e-6, 'tier C: the hit bone only');
  C.tier = tier;
}

{
  // Under locomotion, which leaves the root to the movement (an action played alone owns it).
  const blend = basicBlend();
  MeshBuilder.CreateGround('floor', { width: 20, height: 20 }, blend.scene);
  const hero = new Character(blend, 'Armature', { manual: true }), hits = hero.add(impact());
  hero.body.play(hero.locomotion, { blend: 0 });
  hero.update(DT);
  const before = hero.node.position.clone();
  hits.hit({ bone: 'chest', impulse: new Vector3(20, 0, 0) });
  run([hero], 0.5);
  assert.ok(hero.node.position.x - before.x > 0.02, `a large hit shoves the character (${(hero.node.position.x - before.x).toFixed(3)} m)`);
  assert.throws(() => hits.hit({ bone: 'tail', impulse: Vector3.Zero() }), /impact: no bone or role "tail" on Armature/);
}

console.log('character effects impact: ok');
