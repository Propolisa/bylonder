import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NullEngine, Scene, MeshBuilder, FreeCamera, Vector3, VertexBuffer } from '@babylonjs/core';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { bundleWorker } from '../scripts/modifiers-polyfill.mjs';

// The modifier kernels polyfill (modifiers.wasm, a worker, modifiers.js) keeps an exported scene's modifiers live:
// its result must be the applied export's geometry, for each modifier type and for an animated setting.
assert.equal(await bundleWorker(), (await import('node:fs')).readFileSync(new URL('../src/io_scene_babylon/polyfill/modifiers-worker.bundle.js', import.meta.url), 'utf8'),
  'modifiers-worker.bundle.js is out of date: run node scripts/modifiers-polyfill.mjs');

const engine = new NullEngine(), scene = new Scene(engine);
const camera = new FreeCamera('Camera', new Vector3(0, 5, -20), scene);
const STACKS = [['Subdivision', 'SUBSURF', { levels: 2 }], ['Array', 'ARRAY', { count: 3 }], ['Bevel', 'BEVEL', { width: 0.2, segments: 3 }],
  ['Mirror', 'MIRROR', { use_mirror_merge: false }], ['Solidify', 'SOLIDIFY', { thickness: 0.3 }]];
const cubes = STACKS.map(([name], i) => {
  const cube = MeshBuilder.CreateBox(name, { size: 2 }, scene);
  cube.metadata = { wbId: name, wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
  cube.position.x = i * 4;
  return cube;
});
const animation = createAnimationModel();
const objects = Object.assign([...cubes, asObject(camera)], { scene });
const world = { scene, objects, animation, sceneSettings: { camera: () => camera, state: { name: 'Scene' } } };
world.renderSettings = createRenderSettings(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
registerObjects(animation, objects);
const added = STACKS.map(([, type, values], i) => world.modifiers.add(cubes[i], type, values));
// The Solidify thickness, keyed from 0.1 to 0.5 over the scene range.
animation.time.configure({ frameStart: 1, frameEnd: 20 });
const thickness = animation.ref(`modifier:Solidify:${added[4].id}`, 'thickness');
animation.insert([thickness], 1, 0.1);
animation.insert([thickness], 20, 0.5);
animation.seek(1);
await world.modifiers.settled();

// The module and the polyfill laid out as the Live Modifiers zip has them.
const dir = mkdtempSync(join(tmpdir(), 'bylonder-live-'));
mkdirSync(join(dir, 'bylonder-modifiers'));
copyFileSync(new URL('../src/io_scene_babylon/polyfill/modifiers.js', import.meta.url), join(dir, 'bylonder-modifiers/modifiers.js'));
copyFileSync(new URL('../src/io_scene_babylon/polyfill/modifiers-worker.bundle.js', import.meta.url), join(dir, 'bylonder-modifiers/modifiers-worker.js'));
copyFileSync(new URL('../src/modifiers/modifiers.wasm', import.meta.url), join(dir, 'bylonder-modifiers/modifiers.wasm'));
const source = await exportModule(world, { live: true });
writeFileSync(join(dir, 'scene.mjs'), source.replaceAll("'@babylonjs/core'", JSON.stringify(import.meta.resolve('@babylonjs/core'))));

// A module worker in this realm, as Node has no Web Worker: the bundled worker sets the global onmessage.
globalThis.Worker = class {
  constructor(url) {
    this.loaded = import(url.href);
    globalThis.postMessage = (data) => this.onmessage({ data });
  }
  postMessage(data) { this.loaded.then(() => globalThis.onmessage({ data })); }
  terminate() {}
};

const geometry = (mesh) => ['position', 'normal'].map((kind) => Array.from(mesh.getVerticesData(kind))).concat([Array.from(mesh.getIndices())]);
const same = (a, b) => a.length === b.length && a.every((array, i) => array.length === b[i].length && array.every((v, j) => Math.abs(v - b[i][j]) < 1e-5));

const built = await (await import(pathToFileURL(join(dir, 'scene.mjs')).href)).createScene(new NullEngine(), null);
const live = built.metadata.liveModifiers;
assert.deepEqual(live.meshes.map((m) => m.name), STACKS.map(([name]) => name), 'every stack is live');
for (const cube of cubes) {
  const mesh = built.getMeshByName(cube.name);
  assert.ok(same(geometry(mesh), geometry(cube)), `${cube.name}: the live result is the applied geometry`);
}

// Frame 20: the animation group sets the thickness, the polyfill evaluates again, and the result is Bylonder's.
const group = built.animationGroups[0];
group.pause();
group.goToFrame(20);
built.render();
await live.settled();
animation.seek(20);
await world.modifiers.settled();
const solidify = built.getMeshByName('Solidify');
assert.equal(solidify.metadata.bylonderModifiers.stack[0].values.thickness.toFixed(3), '0.500');
assert.ok(same(geometry(solidify), geometry(cubes[4])), 'Solidify at frame 20: the live result is the applied geometry');
live.dispose();
rmSync(dir, { recursive: true });
console.log('Live modifiers: Subdivision, Array, Bevel, Mirror and Solidify, and an animated Solidify thickness, match the applied export');
