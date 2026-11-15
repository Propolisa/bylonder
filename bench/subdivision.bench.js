// A Subdivision Surface stack through the app's modifier system: a 10k-quad grid at levels 2 and 3 (160k and 640k
// faces), each level change evaluated by Blender's depsgraph in the module, on the threads BYLONDER_THREADS gives it.
// usage: BYLONDER_THREADS=n node bench/subdivision.bench.js [steps]
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { sceneMain } from '../tests/scene-main.js';

const steps = Number(process.argv[2] ?? 6);
const engine = new NullEngine(), scene = new Scene(engine);
const grid = MeshBuilder.CreateGround('Grid', { width: 2, height: 2, subdivisions: 100 }, scene);
grid.metadata = { wbId: 'o0' };
const objects = Object.assign([grid], { scene });
const world = { scene, objects, animation: createAnimationModel() };
world.mainSync = sceneMain(world);
const modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
world.modifiers = modifiers;
const modifier = modifiers.add(grid, 'SUBSURF');
const times = Array.from({ length: steps }, (_, i) => {
  const t = performance.now();
  modifiers.set(grid, modifier.id, 'levels', 2 + (i % 2), { finish: false });
  return performance.now() - t;
});
console.log(`subdivision levels 2 and 3 of a 10k-quad grid: ${times.sort((a, b) => a - b)[steps >> 1].toFixed(0)} ms a change (median of ${steps}), ${process.env.BYLONDER_THREADS ?? 1} threads`);
process.exit(0);
