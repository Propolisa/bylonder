// Geometry Nodes in an exported page (docs/licence-free-live.md) on the Geometry Nodes example (examples/geometry-nodes):
// the planet's modifier is an IR entity run by Bylonder's evaluator, each node through Blender's per-node kernels
// (bylonder-geometry-nodes/), on the IR's own data. No package ships scene.blend; the scene module ships only as the
// kernels (runtime-files.js GEOMETRY_NODES_KERNELS), until they have a module of their own. Controls on
// fast paths leave the baked planet as it is; a set of a modifier input evaluates it, and the planet's mesh (bit for
// bit) and its trees' instances are then the app's, as are later sets; the trees follow the planet when it moves.
import assert from 'node:assert/strict';
import { Matrix, NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { gplFiles, GEOMETRY_NODES_KERNELS } from '../src/io_scene_babylon/runtime-files.js';
import { triangulate } from '../src/io_scene_babylon/runtime/mesh.js';
import { writePackage } from './export-package.js';
import { blendData } from '../src/python/bpy_rna.js';
import { ID_OB } from '../src/blenkernel/main-evaluated.js';
import { current } from '../scripts/modifiers-polyfill.mjs';

assert.ok(await current('geometry-nodes-kernels.bundle.js'), 'geometry-nodes-kernels.bundle.js is out of date: run node scripts/modifiers-polyfill.mjs');

const { world, sync, node } = openExample('geometry-nodes');
sync.view();
const files = await exportModule(world), ir = JSON.parse(files['scene.ir.json']);
const gpl = gplFiles(files), shipped = [...Object.keys(files), ...gpl.map(([path]) => path)];
assert.ok(!shipped.some((path) => /scene\.blend$|bmesh\.wasm$|bylonder-blender/.test(path)), 'the package ships no scene.blend');
const kernels = gpl.find(([path]) => path === 'bylonder-geometry-nodes/geometry-nodes.wasm');
assert.equal(kernels?.[1], GEOMETRY_NODES_KERNELS, 'it ships Blender\'s Geometry Nodes kernels');
assert.ok(gpl.every(([path, from]) => !from.endsWith('bmesh.wasm') || path === kernels[0]), 'and the scene module only as those kernels');

const inputs = (name) => `objects["Planet"].modifiers["Planet"].properties.inputs.${name}.value`;
const [seed, mountains] = [inputs('Socket_2'), inputs('Socket_3')];
const planet = ir.entities['OB:Planet/modifier/Planet'];
assert.equal(planet.type, 'modifier:NODES');
assert.equal(planet.implementation, 'geometry-nodes', 'Geometry Nodes run on Bylonder\'s evaluator');
assert.deepEqual(Object.values(planet.inputs).filter((v) => v.property).map((v) => v.property), ['Socket_2', 'Socket_3', 'Socket_4', 'Socket_5', 'Socket_6'].map(inputs),
  'the modifier entity reads its inputs');
assert.ok(ir.graphs[planet.inputs.graph.graph]?.type === 'GEOMETRY' && planet.inputs.geometry.mesh.vert_positions.buffer !== undefined, 'and its graph and base mesh');
assert.ok(planet.inputs.geometry.mesh.attributes.UVMap?.data.buffer !== undefined, 'with the mesh\'s attributes');
assert.deepEqual(planet.outputs, { geometry: { draw: 'Planet' } });
assert.deepEqual(Object.keys(ir.ids).filter((k) => ir.ids[k].evaluated).sort(), ['OB:Fir', 'OB:Maple', 'OB:Oak', 'OB:Pine'],
  'the trees the graph reads through its collection carry their matrix and mesh');
assert.ok(files['scene.js'].includes('Includes GPL code: bylonder-geometry-nodes/'), 'scene.js says the kernels are GPL');

// The kernels the package ships, counted as they load.
const instantiate = WebAssembly.instantiate;
let loads = 0;
WebAssembly.instantiate = (module, ...rest) => {
  if (module instanceof WebAssembly.Module && WebAssembly.Module.exports(module).some((e) => e.name === 'gn_eval')) loads++;
  return instantiate(module, ...rest);
};
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const page = blend.scene;
const evaluated = () => page.getMeshById('Planet').getChildMeshes(true).some((m) => m.id.startsWith('Planet/'));

// Controls on fast paths: a transform, a light, the frame. The planet stays as the export baked it.
blend.set('objects["Planet"].location[2]', 0.5);
blend.set('lights["Sun"].energy', 3);
blend.set('scenes["Scene"].frame_current', 12);
blend.set('scenes["Scene"].frame_current', 1);
await blend.settled();
blendData().objects.get('Planet').location[2] = 0.5;
assert.ok(!evaluated() && !loads, 'controls on fast paths run no Geometry Nodes');

const vertices = (mesh) => Array.from(mesh.getVerticesData('position'));
const appPlanet = () => triangulate(sync.blender.evaluatedMesh(sync.blender.ids(ID_OB).find((ob) => sync.blender.name(ob) === 'Planet'))).positions;
// Each tree's instances in world space: the meshes drawing it with thin instances, shown.
const trees = ['Fir', 'Maple', 'Oak', 'Pine'];
const instances = (scene, source) => trees.map((name) => scene.meshes.filter((m) => m.hasThinInstances && m.isEnabled() && m.geometry === source(name).geometry).flatMap((carrier) => {
  // Read from the buffer: Babylon's thinInstanceGetWorldMatrices keeps the matrices it first read.
  const world = carrier.computeWorldMatrix(true), data = carrier._thinInstanceDataStorage.matrixData;
  return Array.from({ length: carrier.thinInstanceCount }, (_, i) => Array.from(Matrix.FromArray(data, i * 16).multiply(world).m));
}).sort((a, b) => a[12] - b[12] || a[13] - b[13] || a[14] - b[14]).flat());
const near = (a, b) => a.length === b.length && a.every((list, i) => list.length === b[i].length && list.every((v, j) => Math.abs(v - b[i][j]) < 1e-4));
const sameTrees = (message) => assert.ok(near(instances(page, (name) => page.getMeshById(name)), instances(world.scene, node)), message);
const before = vertices(page.getMeshById('Planet'));
for (const [path, value] of [[seed, 7], [mountains, 0.4], [seed, 31]]) {
  blend.set(path, value);
  await blend.settled();
  blendData().path_resolve(path.replace(/\.value$/, '')).value = value;
  sync.view();
  assert.deepEqual(vertices(page.getMeshById('Planet')), Array.from(appPlanet()), `the planet at ${path} = ${value} is the app's`);
  sameTrees(`the trees at ${path} = ${value} are the app's`);
}
assert.notDeepEqual(vertices(page.getMeshById('Planet')), before, 'the planet changed');
assert.deepEqual(page.getMeshById('Planet').subMeshes.map((s) => s.materialIndex), [0, 1], 'its land and sea keep their materials');

// The planet moved on its fast path after its trees were drawn: they move with it, as in the app.
blend.set('objects["Planet"].location[2]', 1.5);
await blend.settled();
blendData().objects.get('Planet').location = [0, 0, 1.5];
sync.view();
sameTrees('the trees follow the moved planet');
assert.equal(loads, 1, 'the kernels load once');
WebAssembly.instantiate = instantiate;

blend.dispose();
written.remove();
console.log(`Export Geometry Nodes: no scene.blend shipped; fast-path controls run no nodes; inputs evaluate the app's planet and trees on the IR, with ${GEOMETRY_NODES_KERNELS} as the kernels`);
