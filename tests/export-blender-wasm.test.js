// The Blender fallback of an exported page (docs/controllable-exports.md, step 6) on the Geometry Nodes example
// (examples/geometry-nodes): exported with its source .blend, the planet's modifier inputs are controls only Blender
// evaluates. Controls on fast paths read neither Blender's module nor the .blend; the first set of a modifier input
// reads each once, and the planet's mesh (bit for bit) and its trees' instances are then the app's, as are later sets;
// the trees follow the planet when it moves.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Matrix, NullEngine } from '@babylonjs/core';
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
assert.ok(!tunable['scene.blend'] && !tunable['scene.ir.json'].includes('"implementation":"blender"'), 'without its .blend, a package has no Blender fallback');
const files = await exportModule(world, { sourceBlend: true });
const ir = JSON.parse(files['scene.ir.json']);
const inputs = (name) => `objects["Planet"].modifiers["Planet"].properties.inputs.${name}.value`;
const [seed, mountains] = [inputs('Socket_2'), inputs('Socket_3')];
const planet = ir.entities['OB:Planet/modifier/Planet'];
assert.equal(planet.type, 'modifier:NODES');
assert.equal(planet.implementation, 'blender', 'Geometry Nodes run on the interim Blender fallback');
assert.deepEqual(Object.values(planet.inputs).filter((v) => v.property).map((v) => v.property), ['Socket_2', 'Socket_3', 'Socket_4', 'Socket_5', 'Socket_6'].map(inputs),
  'the modifier entity reads its inputs');
assert.ok(ir.graphs[planet.inputs.graph.graph]?.type === 'GEOMETRY' && planet.inputs.geometry.mesh.vert_positions.buffer !== undefined, 'and its graph and base mesh');
assert.deepEqual(planet.outputs, { geometry: { draw: 'Planet' } });
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
// Each tree's instances in world space: a page's carrier is its instancer's child (js-export.js parentInstances), the
// app's is in the world.
const trees = ['Fir', 'Maple', 'Oak', 'Pine'];
const instances = (scene, source) => trees.map((name) => {
  // Read from the buffer: Babylon's thinInstanceGetWorldMatrices keeps the matrices it first read.
  const carrier = scene.meshes.find((m) => m.hasThinInstances && m.geometry === source(name).geometry), world = carrier.computeWorldMatrix(true);
  const data = carrier._thinInstanceDataStorage.matrixData;
  return Array.from({ length: carrier.thinInstanceCount }, (_, i) => Array.from(Matrix.FromArray(data, i * 16).multiply(world).m)).flat();
});
const near = (a, b) => a.length === b.length && a.every((list, i) => list.length === b[i].length && list.every((v, j) => Math.abs(v - b[i][j]) < 1e-5));
const sameTrees = (message) => assert.ok(near(instances(page, (name) => page.getMeshById(name)), instances(world.scene, node)), message);
const before = vertices(page.getMeshById('Planet'));
for (const [path, value] of [[seed, 7], [mountains, 0.4], [seed, 31]]) {
  blend.set(path, value);
  await blend.settled();
  blendData().path_resolve(path.replace(/\.value$/, '')).value = value;
  sync.view();
  assert.deepEqual(vertices(page.getMeshById('Planet')), vertices(node('Planet')), `the planet at ${path} = ${value} is the app's`);
  sameTrees(`the trees at ${path} = ${value} are the app's`);
}
assert.notDeepEqual(vertices(page.getMeshById('Planet')), before, 'the planet changed');

// The planet moved on its fast path after Blender drew its trees: they move with it, as in the app, without Blender.
blend.set('objects["Planet"].location[2]', 1.5);
await blend.settled();
blendData().objects.get('Planet').location = [0, 0, 1.5];
sync.view();
sameTrees('the trees follow the moved planet');
assert.deepEqual(fallbackReads(), [1, 1], 'the module and the .blend are read once');

fs.readFile = readFile;
syncBuiltinESMExports();
blend.dispose();
written.remove();
console.log('Export Blender fallback: fast-path controls read nothing of it; Geometry Nodes inputs load the module and .blend once and draw the app\'s planet and trees');
