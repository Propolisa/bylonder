// Deleting every object by Blender's operator and undoing it: the operator's run is one undo step (the view reading
// Main's collections makes none), and undo brings the objects back into the view.
import assert from 'node:assert/strict';
import { NullEngine, Scene, Vector3, PointLight, FreeCamera } from '@babylonjs/core';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createSelection } from '../src/editors/object/selection.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { createHistory } from '../src/editors/undo/storage.js';
import { asObject } from '../src/runtime/object-transform.js';
import { sceneMain } from './scene-main.js';

const scene = new Scene(new NullEngine()), objects = [];
objects.scene = scene;
const world = { scene, objects };
let history;
// The slice commits its own edits, as the app wires it; what the view reads from Main is not one.
world.collections = createCollections(world, { commit: () => history?.commit() });
const cube = buildMesh(scene, 'Cube', { operator: 'mesh.primitive_cube_add', options: {} });
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
const lamp = asObject(new PointLight('Light', new Vector3(4, 5, 6), scene));
lamp.metadata = { wbId: 'light' };
const camera = asObject(new FreeCamera('Camera', new Vector3(7, 3, -7), scene));
camera.metadata = { wbId: 'camera' };
objects.push(cube, lamp, camera);
const selection = createSelection(scene, objects);
const sync = sceneMain(world, selection);
history = createHistory(objects, () => {}, { main: sync, capture: () => world.collections.capture() ?? null, restore: (state) => world.collections.apply(state ?? undefined) });
const live = () => objects.filter((n) => !n.metadata?.wbDeleted).map((n) => n.name).sort().join();
selection.replace([cube, lamp, camera]);
sync.run(() => sync.blender.run('object.delete', { use_global: false, confirm: false }));
history.commit();
assert.equal(live(), '');
history.undo();
assert.equal(live(), 'Camera,Cube,Light', 'undo brings the deleted objects back');
assert.deepEqual(sync.check(), []);
console.log('Undo of a delete: one step, which brings the objects back');
