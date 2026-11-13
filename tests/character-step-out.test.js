// A character handed back from an action inside props (the Snow demo's Bar Scene: seated on a stool against a bar)
// steps out at walking pace without gaining speed, then walks about freely: props made after the movement (as a page
// adds them) are static colliders it never moves or passes into. The moves are the owner's from a playtest run.
import assert from 'node:assert/strict';
import { NullEngine, Scene, TransformNode, Vector3, MeshBuilder } from '@babylonjs/core';
import { createMovement } from '../src/io_scene_babylon/runtime/character/movement.js';

const scene = new Scene(new NullEngine());
MeshBuilder.CreateGround('Floor', { width: 50, height: 50 }, scene).computeWorldMatrix(true);
const m = createMovement(scene, { node: new TransformNode('Hero', scene) });
m.own('action');
// The demo's bar and stool (docs/demos/character-controller/game.js), placed where the acting sits the character.
const box = (name, size, at) => Object.assign(MeshBuilder.CreateBox(name, size, scene), { position: new Vector3(...at) });
const cylinder = (name, size, at) => Object.assign(MeshBuilder.CreateCylinder(name, size, scene), { position: new Vector3(...at) });
const props = [
  box('Bar Counter', { width: 2.89, height: 1.04, depth: 0.56 }, [-0.605, 0.51, -0.5]),
  box('Bar Top', { width: 3.58, height: 0.08, depth: 0.91 }, [-0.42, 1.05, -0.615]),
  cylinder('Stool Seat', { diameter: 0.4, height: 0.2 }, [0, 0.77, 0.125]),
  cylinder('Stool Leg', { diameter: 0.06, height: 0.67 }, [0, 0.335, 0.125]),
];
const placed = props.map((p) => p.computeWorldMatrix(true).clone());
// Babylon tells of a new mesh a tick after it is made.
await new Promise((resolve) => setTimeout(resolve, 0));

const DT = 1 / 20, STEP_OUT = 1, RADIUS = 0.3;
const seat = new Vector3(0, 0, 0.125);
const clearOfStool = () => Math.hypot(m.position.x - seat.x, m.position.z - seat.z) - 0.2 - RADIUS;
const clearOfBar = () => m.position.z - (-0.615 + 0.455) - RADIUS;

m.own('movement');
let fastest = 0, speed = 0;
for (let t = 0; t < 1; t += DT) {
  const from = m.position.clone();
  m.update(DT, { move: Vector3.Zero() });
  fastest = Math.max(fastest, Vector3.Distance(from, m.position) / DT);
  speed = Math.max(speed, m.velocity.length());
}
assert.ok(fastest <= STEP_OUT + 1e-6, `stepped out at walking pace: ${fastest.toFixed(2)} m/s`);
assert.ok(speed < 1e-6, `being pushed out gave it no speed: ${speed}`);
assert.ok(clearOfStool() > -0.01 && clearOfBar() > -0.01, `stood clear: ${clearOfStool().toFixed(3)} from the stool, ${clearOfBar().toFixed(3)} from the bar`);

// The owner's moves after the take-over (seconds, then the stick), from run-character-controller-2026-11-13.
const moves = [[0.23, 0.9, -0.29], [0.27, 0, 0], [0.73, -0.9, 0.29], [0.27, 0, 0], [0.22, -0.9, 0.29], [0.14, 0, 0], [0.74, 0.9, -0.29],
  [0.63, 0.43, -0.84], [0.08, 0.9, -0.29], [0.08, 0, 0], [0.29, 0.29, 0.9], [1.07, -0.43, 0.84], [0.04, 0.29, 0.9], [0.07, 0, 0],
  [0.42, 0.9, -0.29], [0.37, 0.43, -0.84], [0.4, -0.29, -0.9], [1, 0, 0], [0.4, -0.9, 0.29], [0.98, 0, 0], [0.4, 0.9, -0.29], [1, 0, 0]];
let walked = 0, nearest = Infinity;
for (const [seconds, x, z] of moves) for (let t = 0; t < seconds; t += DT) {
  const from = m.position.clone();
  m.update(DT, { move: new Vector3(x, 0, z) });
  walked += Vector3.Distance(from, m.position);
  nearest = Math.min(nearest, clearOfStool(), clearOfBar());
}
assert.ok(walked > 1.5, `walked about: ${walked.toFixed(2)} m`);
assert.ok(nearest > -0.02, `never into the stool or the bar: ${nearest.toFixed(3)} m`);
// Walking straight at the stool stops against it.
for (let t = 0; t < 2; t += DT) m.update(DT, { move: seat.subtract(m.position).normalize().scaleInPlace(1.4) });
assert.ok(clearOfStool() > -0.02, `stopped at the stool: ${clearOfStool().toFixed(3)} m`);
props.forEach((p, i) => assert.ok(p.computeWorldMatrix(true).equals(placed[i]), `${p.name} did not move`));
console.log(`character step-out: handed back inside a stool and bar, it steps out at ${fastest.toFixed(2)} m/s with no speed gained, then walks ${walked.toFixed(1)} m about them without moving them or passing in`);
