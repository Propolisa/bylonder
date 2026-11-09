import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { NullEngine, Scene, FreeCamera, Vector3 } from '@babylonjs/core';
import { createPrimitive, shadeSmooth } from '../src/editors/object/mesh-catalog.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { sceneMain } from './scene-main.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';
import { bundleWorker } from '../scripts/modifiers-polyfill.mjs';

// Live Modifiers: an exported scene's modifier settings are controls by their Blender paths, and the `modifiers`
// evaluator (modifiers.wasm in a worker) runs a stack when one of them is set, or animated: its result must be the
// applied export's geometry, for each modifier type, a set setting and an animated one.
assert.equal(await bundleWorker(), (await import('node:fs')).readFileSync(new URL('../src/io_scene_babylon/polyfill/modifiers-worker.bundle.js', import.meta.url), 'utf8'),
  'modifiers-worker.bundle.js is out of date: run node scripts/modifiers-polyfill.mjs');

// Every modifier Bylonder offers evaluates in the committed module without trapping (the build's check, which it also
// runs with the module's data moved: tools/blender-port/check-modifiers.mjs).
const checked = execFileSync(process.execPath, [fileURLToPath(new URL('../tools/blender-port/check-modifiers.mjs', import.meta.url)), fileURLToPath(new URL('../src/modifiers/modifiers.wasm', import.meta.url))], { encoding: 'utf8' });
assert.deepEqual(checked.split('\n').filter((line) => line.includes('error:')), [], 'no modifier reports an error');

const engine = new NullEngine(), scene = new Scene(engine);
const camera = new FreeCamera('Camera', new Vector3(0, 5, -20), scene);
const STACKS = [['Subdivision', 'SUBSURF', { levels: 2 }], ['Array', 'ARRAY', { count: 3 }], ['Bevel', 'BEVEL', { width: 0.2, segments: 3 }],
  ['Mirror', 'MIRROR', { use_mirror_merge: false }], ['Solidify', 'SOLIDIFY', { thickness: 0.3 }]];
// Shaded smooth: the polyfill takes a Mesh without its sharp faces, which Main's evaluation keeps.
const cubes = STACKS.map(([name], i) => {
  const cube = shadeSmooth(createPrimitive(name, 'mesh.primitive_cube_add', { size: 2 }, scene));
  cube.metadata.wbId = name;
  cube.position.x = i * 4;
  return cube;
});
const animation = createAnimationModel();
const objects = Object.assign([...cubes, asObject(camera)], { scene });
const world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
// Blender's modifiers evaluate in Main.
sceneMain(world);
registerObjects(animation, objects);
const added = STACKS.map(([, type, values], i) => world.modifiers.add(cubes[i], type, values));
// The Solidify thickness, keyed from 0.1 to 0.5 over the scene range.
animation.time.configure({ frameStart: 1, frameEnd: 20 });
const thickness = animation.ref(`modifier:Solidify:${added[4].id}`, 'thickness');
animation.insert([thickness], 1, 0.1);
animation.insert([thickness], 20, 0.5);
animation.seek(1);
await world.modifiers.settled();

// The package as the Live Modifiers zip has it, bylonder-modifiers/ included.
const files = await exportModule(world, { live: true });
const written = writePackage(files);
const controls = JSON.parse(/const CONTROLS = (.*);/.exec(files['scene.js'])[1]);
const thicknessPath = 'objects["Solidify"].modifiers["Solidify"].thickness';
assert.ok(['objects["Subdivision"].modifiers["Subdivision"].levels', 'objects["Array"].modifiers["Array"].relative_offset_displace[0]', thicknessPath]
  .every((path) => controls.some((c) => c.path === path)), 'modifier settings are controls by their Blender paths');
assert.doesNotMatch(files['scene.js'], /bylonderModifiers|base64/, 'no Babylon-side paths and no geometry in the source');

// A module worker in this realm, as Node has no Web Worker: the bundled worker sets the global onmessage, which a
// worker's global scope has.
globalThis.onmessage = null;
globalThis.Worker = class {
  constructor(url) {
    this.loaded = import(url.href);
    globalThis.postMessage = (data) => this.onmessage({ data });
  }
  postMessage(data) { this.loaded.then(() => globalThis.onmessage({ data })); }
  terminate() {}
};

const geometry = (mesh) => ['position', 'normal'].map((kind) => Array.from(mesh.getVerticesData(kind))).concat([Array.from(mesh.getIndices())]);
// Normals within a 16-bit snorm step: the app draws Blender's draw buffers' normals (draw-mesh.cc), the export's
// polyfill its own float ones.
const TOLERANCE = [1e-5, 1 / 32767, 0];
const same = (a, b) => a.length === b.length && a.every((array, i) => array.length === b[i].length && array.every((v, j) => Math.abs(v - b[i][j]) <= TOLERANCE[i] + 1e-6));

let workers = 0;
const Shim = globalThis.Worker;
globalThis.Worker = class extends Shim { constructor(url) { super(url); workers++; } };
const blend = await (await import(written.url)).load(new NullEngine());
const built = blend.scene;
const group = built.animationGroups[0];
group.pause();
group.goToFrame(1);
built.render();
await blend.settled();
assert.equal(workers, 0, 'no stack runs before a setting changes: the page draws the applied geometry');

// Each stack run with one setting changed, and again at its value at export: the result is the applied geometry.
const DEFAULTS = { Subdivision: ['levels', 2], Array: ['count', 3], Bevel: ['segments', 3], Mirror: ['use_axis[1]', false], Solidify: ['thickness', 0.1] };
for (const cube of cubes) {
  const [setting, value] = DEFAULTS[cube.name], path = `objects["${cube.name}"].modifiers["${cube.name}"].${setting}`;
  const mesh = built.getMeshByName(cube.name);
  blend.set(path, typeof value === 'boolean' ? !value : value + 1);
  await blend.settled();
  assert.ok(!same(geometry(mesh), geometry(cube)), `${cube.name}: another ${setting} draws another result`);
  blend.set(path, value);
  await blend.settled();
  assert.ok(same(geometry(mesh), geometry(cube)), `${cube.name}: the live result is the applied geometry`);
}
assert.equal(workers, 1, 'one worker runs every stack');

// Frame 20: the animation group sets the thickness through its channel, the stack runs again, and the result is Bylonder's.
group.goToFrame(20);
built.render();
await blend.settled();
animation.seek(20);
await world.modifiers.settled();
assert.equal(blend.get(thicknessPath).toFixed(3), '0.500');
assert.ok(same(geometry(built.getMeshByName('Solidify')), geometry(cubes[4])), 'Solidify at frame 20: the live result is the applied geometry');

// Set by path: Bylonder's own stack at the same setting gives the same geometry.
blend.set(thicknessPath, 0.25);
await blend.settled();
world.modifiers.set(cubes[4], added[4].id, 'thickness', 0.25);
await world.modifiers.settled();
assert.ok(same(geometry(built.getMeshByName('Solidify')), geometry(cubes[4])), 'Solidify set to 0.25 by path: the live result is the applied geometry');
blend.dispose();
written.remove();
console.log('Live modifiers: settings by Blender path; Subdivision, Array, Bevel, Mirror and Solidify, and an animated Solidify thickness, match the applied export; nothing runs until a setting changes');
