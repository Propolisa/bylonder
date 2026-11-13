// Locomotion (runtime/character/locomotion.js) on the basic rig, driven by real movement: at a steady walk, run, or
// any speed between, the foot that is down stays still on the ground (stride matching on one shared cycle); a stop
// ends with both feet down where the movement comes to rest; a jump plays from its takeoff and lands from its
// touchdown; a stance blends in; its weights always sum to 1.
import assert from 'node:assert/strict';
import { TransformNode, Vector3, MeshBuilder, Quaternion } from '@babylonjs/core';
import { createMovement } from '../src/io_scene_babylon/runtime/character/movement.js';
import { locomotion } from '../src/io_scene_babylon/runtime/character/locomotion.js';
import { footContacts, contactAt } from '../src/io_scene_babylon/runtime/character/contacts.js';
import { Character, Action } from '../src/io_scene_babylon/runtime/character/core.js';
import { basicBlend } from './fixtures/basic-blend.js';
import { createWorldPose } from '../src/io_scene_babylon/runtime/character/procedural.js';
import { basicRig } from './fixtures/basic-rig.js';

const DT = 1 / 60;
const { skeleton } = basicRig();
const legs = ['Left', 'Right'].map((side) => ['UpLeg', 'Leg', 'Foot'].map((b) => `mixamorig:${side}${b}`));
const feet = legs.map((chain) => skeleton.boneIndex(chain[2]));
// Until the core gives actions their contacts.
if (!('contacts' in Action.prototype)) Object.defineProperty(Action.prototype, 'contacts', { get() { return footContacts(this.clip, this.character.rig, legs); } });

function rig() {
  const blend = basicBlend(), { scene } = blend;
  MeshBuilder.CreateGround('Floor', { width: 400, height: 400 }, scene).computeWorldMatrix(true);
  const hero = new Character(blend, 'Armature', { manual: true });
  hero.clips.set('Crouch', { ...hero.clips.get('Idle'), name: 'Crouch' });
  hero.node = new TransformNode('Hero', scene);
  hero.movement = createMovement(scene, { node: hero.node });
  let intent = { move: Vector3.Zero() };
  hero.input = () => intent;
  const source = locomotion(), custom = hero.custom(source);
  hero.body.play(source, { blend: 0 });
  const world = createWorldPose(skeleton), frame = { played: new Map(), total: 0, contact: [0, 0] };
  const sample = custom.sample;
  custom.sample = (name, weight, options) => {
    frame.played.set(name, (frame.played.get(name) ?? 0) + weight);
    frame.total += weight;
    const contacts = footContacts(hero.clips.get(name), skeleton, legs);
    frame.contact.forEach((_, leg) => { frame.contact[leg] += weight * contactAt(contacts, leg, options.time); });
    sample(name, weight, options);
  };
  /** One frame of the character; gives each foot's world position. */
  const step = (wanted) => {
    intent = wanted;
    frame.played.clear();
    frame.total = 0;
    frame.contact = [0, 0];
    hero.update(DT);
    const { movement } = hero;
    world.root.position = movement.position.asArray();
    const q = Quaternion.RotationYawPitchRoll(Math.atan2(movement.facing.x, movement.facing.z), 0, 0);
    world.root.rotation = [q.x, q.y, q.z, q.w];
    world.update(hero.pose);
    return feet.map((f) => new Vector3(...world.position.subarray(f * 3, f * 3 + 3)));
  };
  return { movement: hero.movement, state: custom.state, step, frame };
}

/**
 * Over `seconds` at a steady intent, how far a foot slides while it is down (its blended contact full): the largest
 * per frame (m/s) and over one contact (m).
 */
function slide(r, seconds, intent) {
  let last = null, lastContact = null, perFrame = 0, perContact = 0;
  const from = [null, null];
  for (let t = 0; t < seconds; t += DT) {
    const at = r.step(intent);
    assert.ok(Math.abs(r.frame.total - 1) < 1e-4, `weights sum to 1: ${r.frame.total}`);
    at.forEach((p, k) => {
      const down = r.frame.contact[k] > 0.999;
      if (!down) from[k] = null;
      else if (!from[k]) from[k] = p.clone();
      else perContact = Math.max(perContact, Math.hypot(p.x - from[k].x, p.z - from[k].z));
      if (down && last && lastContact[k] > 0.999) perFrame = Math.max(perFrame, Math.hypot(p.x - last[k].x, p.z - last[k].z) / DT);
    });
    last = at;
    lastContact = [...r.frame.contact];
  }
  return { perFrame, perContact };
}

for (const speed of [1.2, 2.35, 3.5]) {
  const r = rig(), intent = { move: new Vector3(0, 0, speed) };
  slide(r, 2, intent);
  const { perFrame, perContact } = slide(r, 3, intent);
  console.log(`at ${speed} m/s a planted foot slides at most ${(100 * perFrame / speed).toFixed(1)}% of the speed, ${(100 * perContact).toFixed(1)} cm per contact`);
  assert.ok(perFrame < 0.2 * speed + 0.05, `at ${speed} m/s a planted foot slides ${perFrame.toFixed(3)} m/s`);
  assert.ok(perContact < 0.06, `at ${speed} m/s a planted foot slides ${(100 * perContact).toFixed(1)} cm in a contact`);
}
{
  const r = rig();
  slide(r, 3, { move: new Vector3(0, 0, 1.2) });
  assert.ok(r.frame.played.get('Walk') > 0.99, 'walks at the walk speed');
  for (let t = 0; t < 2.5; t += DT) r.step({ move: Vector3.Zero() });
  assert.ok(r.frame.played.get('Idle') > 0.99, `idle once stopped: ${[...r.frame.played]}`);
  assert.ok(r.state.speeds.walk > 1.1 && r.state.speeds.walk < 1.3 && r.state.speeds.run > 3.3, `speeds from the actions: ${JSON.stringify(r.state.speeds)}`);
}
// Stopping from a walk: the walk's last frames have both feet down (it finishes its step), then idle.
{
  const r = rig();
  slide(r, 2.3, { move: new Vector3(0, 0, 1.2) });
  let lastWalk = null;
  for (let t = 0; t < 2; t += DT) {
    const at = r.step({ move: Vector3.Zero() });
    if ((r.frame.played.get('Walk') ?? 0) > 0.05) lastWalk = at;
  }
  assert.ok(lastWalk.every((p) => p.y < 0.1), `both feet down as the walk fades: ${lastWalk.map((p) => p.y.toFixed(3))}`);
}
// A jump: the Jump action from its takeoff while rising, from its touchdown on landing, then the ground again.
{
  const r = rig(), times = [];
  for (let t = 0; t < 0.5; t += DT) r.step({ move: Vector3.Zero() });
  r.step({ move: Vector3.Zero(), jump: true });
  for (let t = 0; t < 2; t += DT) { r.step({ move: Vector3.Zero() }); times.push([r.movement.grounded, r.state.mode, r.frame.played.get('Jump') ?? 0]); }
  assert.ok(times.slice(0, 5).every(([grounded, mode, w]) => !grounded && mode === 'jump' && w > 0.15), 'jump plays as it leaves');
  assert.ok(times.some(([, mode]) => mode === 'land'), 'lands');
  assert.equal(times.at(-1)[1], 'ground');
  assert.ok(times.at(-1)[2] < 0.01, 'jump faded out');
}
// A stance: crouch's idle blends in and takes over.
{
  const r = rig();
  r.state.stances.crouch = { idle: 'Crouch' };
  for (let t = 0; t < 0.3; t += DT) r.step({ move: Vector3.Zero() });
  r.state.stance = 'crouch';
  r.step({ move: Vector3.Zero() });
  assert.ok(r.frame.played.get('Crouch') > 0 && r.frame.played.get('Idle') > 0, 'both stances while blending');
  for (let t = 0; t < 1; t += DT) r.step({ move: Vector3.Zero() });
  assert.ok(r.frame.played.get('Crouch') > 0.99, 'crouched');
  assert.throws(() => { const s = rig(); s.state.stances.bad = { idle: 'Nope' }; s.state.stance = 'bad'; s.step({ move: Vector3.Zero() }); }, /No action "Nope" on Armature: it has "Idle", "Walk"/);
}
// Turning in place: no step for a turn under 30 degrees; past it the feet step, one at a time, keeping each planted
// foot within 45 degrees of the body; they end under it.
{
  const r = rig(), still = { move: Vector3.Zero() }, wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  for (let t = 0; t < 0.5; t += DT) r.step(still);
  const turn = (degrees) => {
    const yaw = Math.atan2(r.movement.facing.x, r.movement.facing.z) + (degrees * Math.PI) / 180;
    r.movement.turnTo(new Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 0.5 + Math.abs(degrees) / 180);
    let touchdowns = 0, twist = 0, before = [...r.frame.contact];
    for (let t = 0; t < 3; t += DT) {
      r.step(still);
      const body = Math.atan2(r.movement.facing.x, r.movement.facing.z);
      r.frame.contact.forEach((c, k) => {
        if (c > 0.5 && before[k] <= 0.5) touchdowns++;
        if (c > 0.999 && k !== r.state.stepLeg) twist = Math.max(twist, Math.abs(wrap(body - r.state.feetYaw[k])));
      });
      before = [...r.frame.contact];
    }
    const body = Math.atan2(r.movement.facing.x, r.movement.facing.z), settled = Math.max(...[0, 1].map((k) => Math.abs(wrap(body - r.state.feetYaw[k]))));
    return { touchdowns, twist: (twist * 180) / Math.PI, settled: (settled * 180) / Math.PI };
  };
  const small = turn(20);
  assert.equal(small.touchdowns, 0, 'no step for 20 degrees');
  for (const degrees of [90, -180]) {
    const { touchdowns, twist, settled } = turn(degrees);
    console.log(`a ${Math.abs(degrees)} degree turn in place: ${touchdowns} touchdowns, the feet at most ${twist.toFixed(0)} degrees behind the body`);
    assert.ok(touchdowns >= 2, `${degrees}: steps (${touchdowns})`);
    assert.ok(twist < 45, `${degrees}: a planted foot ${twist.toFixed(0)} degrees from the body`);
    assert.ok(settled < 8.5, `${degrees}: the feet end under the body (${settled.toFixed(1)} degrees)`);
  }
}
// A reversal (180 or 135 degrees, at a walk or a run) is one pivot: it stops, turns in place stepping round, then goes
// the other way. No step is hurried: the gaits play at most 10% over their own rate, and the turning steps follow
// each other no quicker than the walk's own steps.
for (const [speed, degrees] of [[1.2, 180], [1.2, 135], [3.5, 180], [3.5, 135]]) {
  const r = rig(), wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI)), heading = (degrees * Math.PI) / 180;
  for (let t = 0; t < 2; t += DT) r.step({ move: new Vector3(0, 0, speed) });
  const walk = r.state.sets.get('stand').moving[0], walkStep = walk.duration / walk.swings.length;
  let fastest = 0, pivots = 0, turning = false, lastYaw = 0, stepped = -Infinity, quickest = Infinity, steps = 0, leg = -1;
  for (let t = 0; t < 4; t += DT) {
    r.step({ move: new Vector3(Math.sin(heading) * speed, 0, Math.cos(heading) * speed) });
    if (r.state.moving > 0.05) fastest = Math.max(fastest, r.state.rate);
    const yaw = Math.atan2(r.movement.facing.x, r.movement.facing.z), spin = Math.abs(wrap(yaw - lastYaw)) / DT;
    const inPlace = spin > 0.5 && r.movement.velocity.length() < 0.3;
    if (inPlace && !turning) pivots++;
    turning = inPlace;
    lastYaw = yaw;
    if (r.state.stepLeg >= 0 && leg < 0) { quickest = Math.min(quickest, t - stepped); stepped = t; steps++; }
    leg = r.state.stepLeg;
  }
  const what = `${degrees} degrees at ${speed} m/s`;
  console.log(`a reversal of ${what}: ${pivots} pivot, ${steps} turning steps at least ${quickest.toFixed(2)} s apart (the walk's step ${walkStep.toFixed(2)} s), gaits at most ${fastest.toFixed(2)} of their rate`);
  assert.equal(pivots, 1, `${what}: one pivot`);
  assert.ok(fastest <= 1.1, `${what}: the gaits at ${fastest.toFixed(2)} of their own rate`);
  assert.ok(steps >= 2 && quickest >= walkStep / 1.1, `${what}: ${steps} turning steps, ${quickest.toFixed(2)} s apart`);
  assert.ok(Math.abs(wrap(Math.atan2(r.movement.facing.x, r.movement.facing.z) - heading)) < 0.02, `${what}: it faces the new way`);
}
// A landing gives way: moving on at a walk, the jump's pose is under 5% within 0.6 s (its landing lasts 0.3 s), and at
// no frame does its weight drop by more than a fifth (no snap), standing or moving.
for (const move of [Vector3.Zero(), new Vector3(0, 0, 1.2)]) {
  const r = rig(), still = { move: Vector3.Zero() };
  for (let t = 0; t < 0.5; t += DT) r.step(still);
  r.step({ move: Vector3.Zero(), jump: true });
  while (r.state.mode !== 'land') r.step(still);
  let last = r.frame.played.get('Jump') ?? 0, gone = null, drop = 0;
  for (let t = 0; t < 3; t += DT) {
    r.step({ move });
    const now = r.frame.played.get('Jump') ?? 0;
    drop = Math.max(drop, last - now);
    if (gone === null && now < 0.05) gone = t;
    last = now;
  }
  assert.ok(drop < 0.2, `the landing's weight drops ${drop.toFixed(2)} in one frame`);
  if (move.z) assert.ok(gone !== null && gone < 0.6, `moving on, the landing is gone after ${gone?.toFixed(2)} s`);
}
console.log('character locomotion ok');
