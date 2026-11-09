// The Blender fallback of an exported page (docs/controllable-exports.md, step 6) on the Geometry Nodes example
// (examples/geometry-nodes): exported with its source .blend, the planet's modifier inputs are controls only Blender
// evaluates. Controls on fast paths read neither Blender's module nor the .blend; the first set of a modifier input
// reads each once, and the planet's mesh and its trees' instances are then the app's, bit for bit, as are later sets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';
import { blendData } from '../src/python/bpy_rna.js';
import { bundleFallback } from '../scripts/blender-fallback.mjs';

assert.equal(await bundleFallback(), readFileSync(new URL('../src/io_scene_babylon/blender-fallback.bundle.js', import.meta.url), 'utf8'),
  'blender-fallback.bundle.js is out of date: run node scripts/blender-fallback.mjs src/io_scene_babylon/blender-fallback.bundle.js');

const { world, sync, node } = openExample('geometry-nodes');
sync.view();
const tunable = await exportModule(world);
assert.ok(!tunable['scene.blend'] && !tunable['scene.js'].includes('"evaluator":"blender"'), 'without its .blend, a package has no Blender fallback');
const files = await exportModule(world, { sourceBlend: true });
const table = JSON.parse(/const DEPENDENCIES = (.*);/.exec(files['scene.js'])[1]);
const inputs = (name) => `objects["Planet"].modifiers["Planet"].properties.inputs.${name}.value`;
const [seed, mountains] = [inputs('Socket_2'), inputs('Socket_3')];
const controls = JSON.parse(/const CONTROLS = (.*);/.exec(files['scene.js'])[1]);
assert.deepEqual(table.operations.filter((op) => op.evaluator === 'blender').map((op) => op.reads.map((i) => controls[i].path)), [['Socket_2', 'Socket_3', 'Socket_4', 'Socket_5', 'Socket_6'].map(inputs)],
  'one Blender operation reads the modifier\'s inputs');
assert.ok(files['scene.blend']?.length > 0 && files['scene.js'].includes('Includes GPL code'), 'the package ships its .blend and says its fallback is GPL');

// Reads of the package's files, by name, through the platform's file reads (fetch's in Node).
const reads = new Map(), fs = process.getBuiltinModule('fs/promises'), readFile = fs.readFile;
const written = writePackage(files);
fs.readFile = (path, ...rest) => {
  const file = fileURLToPath(path);
  if (file.startsWith(written.dir)) reads.set(file.slice(written.dir.length + 1).replaceAll('\\', '/'), (reads.get(file.slice(written.dir.length + 1).replaceAll('\\', '/')) ?? 0) + 1);
  return readFile(path, ...rest);
};
syncBuiltinESMExports();
const blend = await (await import(written.url)).load(new NullEngine());
const page = blend.scene;
const fallbackReads = () => ['scene.blend', 'bylonder-blender/bmesh.wasm'].map((name) => reads.get(name) ?? 0);

// Controls on fast paths: a transform, a light, the frame. Blender's Main takes the changed ones when it first runs.
blend.set('objects["Planet"].location[2]', 0.5);
blend.set('lights["Sun"].energy', 3);
blend.set('scenes["Scene"].frame_current', 12);
blend.set('scenes["Scene"].frame_current', 1);
await blend.settled();
blendData().objects.get('Planet').location[2] = 0.5;
assert.deepEqual(fallbackReads(), [0, 0], 'controls on fast paths read neither the module nor the .blend');

const vertices = (mesh) => Array.from(mesh.getVerticesData('position'));
const instances = (scene, names) => names.map((name) => scene.meshes.find((m) => m.hasThinInstances && m.geometry === scene.getMeshById(name)?.geometry)).map((m) => Array.from(m.thinInstanceGetWorldMatrices().flatMap((matrix) => Array.from(matrix.m))));
const trees = ['Fir', 'Maple', 'Oak', 'Pine'];
const appInstances = () => trees.map((name) => {
  const carrier = world.scene.meshes.find((m) => m.hasThinInstances && m.geometry === node(name).geometry);
  return Array.from(carrier.thinInstanceGetWorldMatrices().flatMap((matrix) => Array.from(matrix.m)));
});
const before = vertices(page.getMeshById('Planet'));
for (const [path, value] of [[seed, 7], [mountains, 0.4], [seed, 31]]) {
  blend.set(path, value);
  await blend.settled();
  blendData().path_resolve(path.replace(/\.value$/, '')).value = value;
  sync.view();
  assert.deepEqual(vertices(page.getMeshById('Planet')), vertices(node('Planet')), `the planet at ${path} = ${value} is the app's`);
  assert.deepEqual(instances(page, trees), appInstances(), `the trees at ${path} = ${value} are the app's`);
}
assert.notDeepEqual(vertices(page.getMeshById('Planet')), before, 'the planet changed');
assert.deepEqual(fallbackReads(), [1, 1], 'the module and the .blend are read once');

fs.readFile = readFile;
syncBuiltinESMExports();
blend.dispose();
written.remove();
console.log('Export Blender fallback: fast-path controls read nothing of it; Geometry Nodes inputs load the module and .blend once and draw the app\'s planet and trees');
