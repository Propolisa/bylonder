// A drag step on a modifier's value through the app's path (the modifier system on Main's sync and view): its value
// written, Main evaluated and what it updated drawn, on a 100k-triangle ground among 300 other objects.
// usage: node bench/modifier-drag.bench.js [steps]
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { sceneMain } from '../tests/scene-main.js';

const steps = Number(process.argv[2] ?? 20);
const engine = new NullEngine(), scene = new Scene(engine);
const ground = MeshBuilder.CreateGround('Ground', { width: 2, height: 2, subdivisions: 224 }, scene);
const others = Array.from({ length: 300 }, (_, i) => MeshBuilder.CreateBox('Box' + i, { size: 1 }, scene));
const objects = [ground, ...others];
objects.forEach((node, i) => { node.metadata = { wbId: 'o' + i }; });
objects.scene = scene;
const world = { scene, objects, animation: createAnimationModel() };
world.mainSync = sceneMain(world);
const modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
world.modifiers = modifiers;

for (const [type, path, value] of [['DISPLACE', 'strength', (i) => 0.5 + (i % 2) / 10], ['ARRAY', 'count', (i) => 2 + (i % 2)]]) {
  const modifier = modifiers.add(ground, type);
  modifiers.set(ground, modifier.id, path, value(1), { finish: false });
  const times = [];
  for (let i = 0; i < steps; i++) {
    const t = performance.now();
    modifiers.set(ground, modifier.id, path, value(i), { finish: false });
    times.push(performance.now() - t);
  }
  console.log(`${type} ${path}: ${times.sort((a, b) => a - b)[steps >> 1].toFixed(1)} ms a step (median of ${steps})`);
  modifiers.remove(ground, modifier.id);
}
