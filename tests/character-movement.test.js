// The character's movement (runtime/character/movement.js): it reaches the intent's speed by a critically damped spring
// whose half-life is `responsiveness`, its prediction matches what it then does, it stays on the ground over a step
// and a slope, slides along a wall, falls off a ledge, jumps and lands, and hands the root to an action and back
// without a jump in velocity, keeping a jump asked in the action's last 0.3 s; a body that moves with it costs no
// collision upkeep.
import assert from 'node:assert/strict';
import { NullEngine, Scene, TransformNode, Vector3, MeshBuilder, Matrix } from '@babylonjs/core';
import { createMovement } from '../src/io_scene_babylon/runtime/character/movement.js';
import { collisionWorld } from '../src/io_scene_babylon/runtime/character/collision.js';

const DT = 1 / 60;
const close = (a, b, tolerance, what) => assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a.toFixed(4)} vs ${b}`);

function world() {
  const scene = new Scene(new NullEngine());
  MeshBuilder.CreateGround('Floor', { width: 200, height: 200 }, scene);
  // A 20 cm step at z 10 to 12, a wall along x = 5, a 1.5 m ledge from z = -10 to -20 at x < -10.
  const step = MeshBuilder.CreateBox('Step', { width: 4, height: 0.2, depth: 2 }, scene);
  step.position.set(0, 0.1, 11);
  const wall = MeshBuilder.CreateBox('Wall', { width: 0.4, height: 3, depth: 40 }, scene);
  wall.position.set(5.2, 1.5, -30);
  const ledge = MeshBuilder.CreateBox('Ledge', { width: 10, height: 1.5, depth: 10 }, scene);
  ledge.position.set(-15, 0.75, -15);
  const ramp = MeshBuilder.CreateBox('Ramp', { width: 4, height: 0.1, depth: 10 }, scene);
  ramp.position.set(20, 0, 0);
  ramp.rotation.x = -0.3;
  for (const mesh of scene.meshes) mesh.computeWorldMatrix(true);
  return scene;
}

function character(scene, at = new Vector3(0, 0, 0)) {
  const node = new TransformNode('Hero', scene);
  node.position.copyFrom(at);
  return createMovement(scene, { node });
}
const run = (movement, seconds, intent) => { for (let t = 0; t < seconds - 1e-9; t += DT) movement.update(DT, intent()); };
const still = () => ({ move: Vector3.Zero() });

// Speeding up: at the spring's half-life the speed is a little under half way (critical damping lags), close to the
// goal after a second, never past it.
{
  const scene = world(), m = character(scene);
  let peak = 0;
  run(m, 0.1, () => ({ move: new Vector3(0, 0, 2) }));
  assert.ok(m.velocity.z > 0.4 && m.velocity.z < 1.2, `after one half-life: ${m.velocity.z}`);
  for (let i = 0; i < 60; i++) { m.update(DT, { move: new Vector3(0, 0, 2) }); peak = Math.max(peak, m.velocity.z); }
  close(m.velocity.z, 2, 0.01, 'reaches the goal speed');
  assert.ok(peak <= 2 + 1e-6, 'never overshoots');
  close(m.facing.z, 1, 1e-3, 'faces where it moves');
}

// Prediction: where it says it will be in 1 s is where it is after 1 s of the same intent, turning included.
{
  const scene = world(), m = character(scene, new Vector3(-30, 0, 30));
  run(m, 0.3, () => ({ move: new Vector3(0, 0, 1.4) }));
  const intent = () => ({ move: new Vector3(3, 0, 0) });
  m.update(DT, intent());
  const out = { position: new Vector3(), facing: new Vector3() };
  m.predict(1, out);
  run(m, 1, intent);
  close(Vector3.Distance(out.position, m.position), 0, 0.01, 'predicted position');
  close(Vector3.Dot(out.facing, m.facing), 1, 1e-3, 'predicted facing');
}

// Stopping: it slides to a stop as predicted; responsiveness changes how far.
{
  const distances = [0.05, 0.2].map((responsiveness) => {
    const scene = world(), m = character(scene, new Vector3(-30, 0, -40 + 10));
    m.responsiveness = responsiveness;
    run(m, 2, () => ({ move: new Vector3(0, 0, 3) }));
    const from = m.position.z, out = { position: new Vector3(), facing: new Vector3() };
    m.update(DT, still());
    m.predict(2, out);
    run(m, 2, still);
    close(m.position.z, out.position.z, 0.01, 'stops where predicted');
    return m.position.z - from;
  });
  assert.ok(distances[1] > 3 * distances[0], `heavier stops further: ${distances.map((d) => d.toFixed(2))}`);
}

// Over a step, onto it and off it, without leaving the ground; up a slope.
{
  const scene = world(), m = character(scene, new Vector3(0, 0, 8));
  run(m, 1.5, () => ({ move: new Vector3(0, 0, 2) }));
  close(m.position.y, 0.2, 1e-3, 'on the step');
  run(m, 2, () => ({ move: new Vector3(0, 0, 2) }));
  close(m.position.y, 0, 1e-3, 'off the step');
  assert.ok(m.grounded, 'grounded after the step');
  const ramp = character(scene, new Vector3(20, 0, -2));
  run(ramp, 3, () => ({ move: new Vector3(0, 0, 2) }));
  assert.ok(ramp.position.y > 0.5 && ramp.grounded, `up the ramp: ${ramp.position.y}`);
}

// A wall: it stops short of it by its radius and slides along it.
{
  const scene = world(), m = character(scene, new Vector3(3, 0, -30));
  run(m, 2, () => ({ move: new Vector3(2, 0, 1) }));
  assert.ok(m.position.x < 5 - 0.25 && m.position.x > 4.5, `held by the wall: ${m.position.x}`);
  assert.ok(m.position.z > -29, `slid along it: ${m.position.z}`);
  close(m.velocity.x, 0, 0.05, 'no speed into the wall');
}

// A ledge: it walks off, falls 1.5 m and lands; a jump goes up about 0.9 m and lands again.
{
  const scene = world(), m = character(scene, new Vector3(-15, 1.5, -15));
  close(m.position.y, 1.5, 1e-3, 'starts on the ledge');
  let fell = false;
  run(m, 3, () => { fell ||= !m.grounded; return { move: new Vector3(0, 0, 3) }; });
  assert.ok(fell && m.grounded, 'fell and landed');
  close(m.position.y, 0, 1e-3, 'on the floor');
  let top = 0;
  m.update(DT, { move: Vector3.Zero(), jump: true });
  assert.ok(!m.grounded && m.velocity.y > 3, 'jumped');
  run(m, 2, () => { top = Math.max(top, m.position.y); return still(); });
  close(top, 0.9, 0.05, 'jump height');
  assert.ok(m.grounded, 'landed');
}

// An action owns the root: intent waits, the movement follows it, and taking over keeps its velocity; a jump asked in
// its last 0.3 s happens on the hand back, one asked earlier does not.
for (const askedBefore of [0.2, 0.5]) {
  const scene = world(), m = character(scene, new Vector3(30, 0, 30));
  m.own('action');
  const at = new Vector3(30, 0, 30), facing = new Vector3(0, 0, 1);
  for (let t = 0; t < 1; t += DT) {
    at.z += 2 * DT;
    const jump = Math.abs(t - (1 - askedBefore)) < DT / 2;
    m.update(DT, { move: new Vector3(-3, 0, 0), jump });
    m.follow(DT, at, facing);
  }
  close(m.position.z, at.z, 1e-6, 'followed the action');
  close(m.velocity.z, 2, 1e-3, 'took its velocity');
  m.own('movement');
  m.update(DT, { move: new Vector3(0, 0, 2) });
  close(m.velocity.z, 2, 0.01, 'continues at the action velocity');
  assert.equal(!m.grounded, askedBefore < 0.3, `a jump ${askedBefore} s before the end ${askedBefore < 0.3 ? 'kept' : 'dropped'}`);
}

// place and turnTo own the root while they run and resolve on arrival.
{
  const scene = world(), m = character(scene, new Vector3(-40, 0, 40));
  let done = false;
  m.place(new Vector3(-39, 0, 41), new Vector3(1, 0, 0), 0.6).then(() => { done = true; });
  assert.equal(m.owner, 'place');
  run(m, 0.7, still);
  await null;
  assert.ok(done, 'place resolved');
  assert.equal(m.owner, 'movement');
  close(Vector3.Distance(m.position, new Vector3(-39, 0, 41)), 0, 1e-4, 'placed');
  close(m.facing.x, 1, 1e-4, 'faces the mark');
  const turned = m.turnTo(new Vector3(0, 0, -1), 0.5);
  run(m, 0.6, still);
  await turned;
  close(m.facing.z, -1, 1e-4, 'turned');
}

// At speed: a thin wall stops a run of 15 m/s (a step of 25 cm a frame, under the capsule's radius) without letting it
// through; a slope steeper than 50 degrees is a wall; grass (low instances, thin instances) is walked through.
{
  const scene = world(), thin = MeshBuilder.CreateBox('Thin Wall', { width: 4, height: 3, depth: 0.05 }, scene);
  thin.position.set(-40, 1.5, -40);
  const steep = MeshBuilder.CreateBox('Steep', { width: 4, height: 0.1, depth: 6 }, scene);
  steep.position.set(-30, 0, -40);
  steep.rotation.x = -1.1;
  const tuft = MeshBuilder.CreateBox('Tuft', { size: 0.2 }, scene);
  tuft.position.set(-50, 0.1, -48);
  const tufts = [-47, -46, -45].map((z) => Object.assign(tuft.createInstance(`Tuft ${z}`), { position: new Vector3(-50, 0.1, z) }));
  const blade = MeshBuilder.CreateBox('Blade', { size: 1 }, scene);
  blade.thinInstanceAdd(Matrix.Translation(-52, 0.5, -45));
  for (const mesh of scene.meshes) mesh.computeWorldMatrix(true);
  const fast = character(scene, new Vector3(-40, 0, -43));
  run(fast, 1, () => ({ move: new Vector3(0, 0, 15) }));
  assert.ok(fast.position.z < -40 - 0.25, `stopped by the thin wall at speed: ${fast.position.z}`);
  const up = character(scene, new Vector3(-30, 0, -45));
  run(up, 3, () => ({ move: new Vector3(0, 0, 2) }));
  assert.ok(up.position.y < 0.4, `a 63 degree slope is a wall: up to ${up.position.y.toFixed(2)} m`);
  const walker = character(scene, new Vector3(-50, 0, -49));
  run(walker, 2.5, () => ({ move: new Vector3(0, 0, 2) }));
  assert.ok(walker.position.z > -45 && Math.abs(walker.position.y) < 1e-3, `through the grass, on the ground: ${walker.position}`);
  assert.equal(tufts.length, 3);
  const wide = character(scene, new Vector3(-52, 0, -47));
  run(wide, 2, () => ({ move: new Vector3(0, 0, 2) }));
  assert.ok(wide.position.z > -44, `through a thin instance: ${wide.position.z}`);
}

// The character's own meshes (any mesh under its node, skinned or not) and meshes that cannot be picked (a sky box) never
// stop it.
{
  const scene = world(), node = new TransformNode('Rig', scene);
  node.position.set(60, 0, 60);
  const shell = MeshBuilder.CreateBox('Helper', { size: 1.2 }, scene);
  shell.parent = node;
  shell.position.y = 0.9;
  const sky = MeshBuilder.CreateBox('Sky', { size: 3 }, scene);
  Object.assign(sky, { isPickable: false, infiniteDistance: true });
  sky.position.set(60, 1.5, 61);
  for (const mesh of scene.meshes) mesh.computeWorldMatrix(true);
  const m = createMovement(scene, { node });
  run(m, 1.5, () => ({ move: new Vector3(0, 0, 1.5) }));
  assert.ok(m.position.z > 61.5, `walks out of its own helper and through the sky box: ${m.position.z}`);
}

// A hidden mesh (disabled, invisible or at visibility 0) neither stops nor holds the character; shown again, it does.
{
  const scene = world(), wall = MeshBuilder.CreateBox('Door', { width: 4, height: 3, depth: 0.3 }, scene);
  wall.position.set(70, 1.5, 72);
  wall.computeWorldMatrix(true);
  for (const hide of [(m) => m.setEnabled(false), (m) => { m.isVisible = false; }, (m) => { m.visibility = 0; }]) {
    hide(wall);
    const m = character(scene, new Vector3(70, 0, 70));
    run(m, 2, () => ({ move: new Vector3(0, 0, 2) }));
    assert.ok(m.position.z > 73, `through the hidden door: ${m.position.z}`);
    Object.assign(wall, { isVisible: true, visibility: 1 });
    wall.setEnabled(true);
    const n = character(scene, new Vector3(70, 0, 70));
    run(n, 2, () => ({ move: new Vector3(0, 0, 2) }));
    assert.ok(n.position.z < 72, `stopped by it shown: ${n.position.z}`);
  }
}

// A lift: a ground mesh moved up under the character carries it, read at once.
{
  const scene = world(), lift = MeshBuilder.CreateBox('Lift', { width: 2, height: 0.2, depth: 2 }, scene);
  lift.position.set(40, -0.1, 40);
  lift.computeWorldMatrix(true);
  const m = character(scene, new Vector3(40, 0, 40));
  run(m, 0.2, still);
  close(m.ground(40, 40).height, 0, 1e-3, 'the lift level with the floor');
  lift.position.y = 0.2;
  lift.computeWorldMatrix(true);
  close(m.ground(40, 40).height, 0.3, 1e-3, 'the lift raised');
  run(m, DT, still);
  close(m.position.y, 0.3, 1e-3, 'carried up');
}

// A body that moves every frame and that no character collides with (a character's own, under its node) is never put
// in the collision world's cells again: walking costs no relinking of it. A lift still carries (above).
{
  const scene = world(), m = character(scene, new Vector3(-60, 0, 60)), node = scene.getTransformNodeByName('Hero');
  const body = MeshBuilder.CreateSphere('Body', { diameter: 1.6, segments: 64 }, scene);
  body.parent = node;
  // Babylon tells of a new mesh a tick after it is made.
  await new Promise((done) => setTimeout(done, 0));
  body.computeWorldMatrix(true);
  const cellsOf = collisionWorld(scene, 0.35), entry = cellsOf.meshes.find((e) => e.mesh === body), cells = [...entry.keys];
  run(m, 1, () => ({ move: new Vector3(1.5, 0, 0) }));
  body.computeWorldMatrix(true);
  assert.ok(m.position.x > -59, `it walked (${m.position.x.toFixed(2)})`);
  assert.deepEqual(entry.keys, cells, 'its own moving body was never put in new cells');
}

// A shove: it slides away from it and comes back to rest.
{
  const scene = world(), m = character(scene, new Vector3(-40, 0, -40));
  m.update(DT, still());
  m.push(new Vector3(3, 0, 0));
  run(m, 0.2, still);
  const pushed = m.position.x + 40;
  assert.ok(pushed > 0.2, `shoved: ${pushed}`);
  run(m, 2, still);
  assert.ok(m.velocity.length() < 0.01 && m.position.x + 40 < 0.6, `came to rest: ${m.position.x + 40}`);
}

console.log('character movement ok');
