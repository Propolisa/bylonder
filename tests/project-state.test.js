// A project's saved scene state (runtime/project-state.js): its .blend and what Babylon owns. The project's code builds
// the scene again; objects whose id the .blend holds take Blender's state from it, a deleted one stays deleted, one
// Blender's code added comes back, and a mesh Babylon built keeps its geometry.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, Vector3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { createHistory } from '../src/editors/undo/storage.js';
import { projectState, openProject } from '../src/runtime/project-state.js';
import { addModifier } from '../src/modifiers/stack.js';

// The project's code: a Blender primitive, a mesh Babylon builds and an empty.
function build() {
  const scene = new Scene(new NullEngine()), objects = [];
  const cube = buildMesh(scene, 'Cube', { operator: 'mesh.primitive_cube_add', options: {} });
  cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
  const knot = MeshBuilder.CreateTorusKnot('Knot', {}, scene);
  knot.metadata = { wbId: 'knot' };
  const ball = MeshBuilder.CreateSphere('Ball', {}, scene);
  ball.metadata = { wbId: 'ball' };
  objects.push(cube, knot, ball);
  objects.scene = scene;
  return { scene, objects, animation: createAnimationModel() };
}
function start(world) {
  world.collections = createCollections(world);
  const selection = createSelection(world.scene, world.objects);
  world.mainSync = createMainSync({ rna: createRNA({ world, selection }), ids: world.animation.ids });
  world.mainSync.debug = true;
  return selection;
}

const first = build(), selection = start(first);
const history = createHistory(first.objects, () => {}, { main: first.mainSync });
const [cube, knot, ball] = first.objects;
const knotVertices = knot.getTotalVertices();
cube.position = new Vector3(1, 2, 3);
knot.position.x = 5;
addModifier(knot, 'SUBSURF', { levels: 1 });
first.mainSync.objectChanged(knot);
const knotDrawn = knot.getTotalVertices();
assert(knotDrawn > knotVertices, 'Main subdivides the knot');
ball.metadata = { ...ball.metadata, wbDeleted: true };
ball.setEnabled(false);
history.commit();
// Blender's code: scaling applied to the cube's Mesh, and an object it adds.
selection.replace([cube]);
cube.scaling = new Vector3(2, 2, 2);
first.mainSync.run(() => first.mainSync.blender.run('object.transform_apply', { location: false, rotation: false, scale: true }), { meshes: [cube] });
first.mainSync.run(() => first.mainSync.blender.run('object.empty_add', { location: [0, 0, 4] }));
cube.name = 'Box';
history.commit();
const saved = JSON.parse(JSON.stringify(projectState(first)));
assert(saved.blend.length < 200000, `the .blend is ${saved.blend.length} characters`);

const second = build();
openProject(second, second.animation.ids, saved);
start(second);
const named = (name) => second.objects.find((node) => node.name === name && !node.metadata?.wbDeleted);
const box = named('Box');
assert(box, 'the renamed cube');
assert.deepEqual(box.position.asArray(), [1, 2, 3]);
assert.equal(Math.max(...box.getVerticesData('position').map(Math.abs)), 2, 'the cube has the scale applied to its Mesh');
assert.equal(named('Knot').position.x, 5);
assert.equal(named('Knot').getTotalVertices(), knotDrawn, 'the knot keeps its geometry, subdivided');
assert.deepEqual(second.mainSync.modifiers.of(named('Knot')).map((m) => m.type), ['SUBSURF'], 'its modifier stack');
assert(!named('Ball'), 'the deleted ball stays deleted');
assert(named('Empty'), "the object Blender's code added");
assert.deepEqual(second.mainSync.check(), []);
assert.equal(second.mainSync.blender.ids(0x424f).length, 3, 'Main holds the objects once');
console.log('Project state: a saved .blend over the code-built scene keeps names, transforms, geometry, deletions and added objects');
