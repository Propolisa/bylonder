// Edit Mode as Blender's mode on Main's object: Blender's operators enter it (the Mesh's BMEditMesh), edit it and leave
// it; the view draws the edit mesh and its overlay; undo and redo load Blender's edit-mode steps.
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createSelection } from '../src/editors/object/selection.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { createHistory } from '../src/editors/undo/storage.js';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { sceneMain } from './scene-main.js';
import { createMeshEditMode } from '../src/editors/mesh/editmesh-mode.js';

const scene = new Scene(new NullEngine()), objects = [];
objects.scene = scene;
const world = { scene, objects };
world.collections = createCollections(world);
const cube = buildMesh(scene, 'Cube', { operator: 'mesh.primitive_cube_add', options: {} });
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
objects.push(cube);
const selection = createSelection(scene, objects);
selection.replace([cube]);
const sync = sceneMain(world, selection), { blender } = sync;
const history = createHistory(objects, () => {}, { main: sync });
const run = (idname, props) => sync.run(() => blender.run(idname, props));
const vertices = () => cube.getTotalVertices();

assert.equal(run('object.editmode_toggle').status, OPERATOR_FINISHED);
assert(blender.editMesh(sync.objectOf(cube)), "Main's Mesh has its edit mesh");
assert.equal(cube.metadata.wbMode, 'EDIT');
assert(scene.meshes.some((mesh) => mesh.parent === cube && mesh.metadata?.overlay), 'the edit overlay is drawn');
history.commit();
const before = vertices();
assert.equal(run('mesh.select_all', { action: 'SELECT' }).status, OPERATOR_FINISHED);
assert.equal(run('mesh.subdivide', { number_cuts: 1 }).status, OPERATOR_FINISHED);
assert(vertices() > before, `the subdivided edit mesh is drawn: ${before} to ${vertices()}`);
const subdivided = vertices();
history.commit();
history.undo();
assert.equal(vertices(), before, 'undo loads the edit-mode step before');
assert(blender.editMesh(sync.objectOf(cube)), 'still in Edit Mode');
history.redo();
assert.equal(vertices(), subdivided);
assert.equal(run('object.editmode_toggle').status, OPERATOR_FINISHED);
assert.equal(cube.metadata.wbMode, 'OBJECT');
assert(!scene.meshes.some((mesh) => mesh.parent === cube && mesh.metadata?.overlay), 'the overlay goes');
assert.equal(blender.mesh(sync.objectOf(cube)).faces_num, 24, "leaving Edit Mode writes the edit mesh to Main's Mesh");
assert.deepEqual(sync.check(), []);

// The editor's Edit Mode (editmesh-mode.js) is that one: it enters and leaves it with object.mode_set, runs Blender's
// operators on it as undo steps and reads its select mode and statistics.
world.mainSync = sync;
const host = { transaction: (fn) => { fn(); history.commit(); }, notify: (text) => assert(!text, text), keying: (fn) => fn(), commit: () => history.commit(),
  wm: () => null, pointer: () => null, view: () => null };
const mode = createMeshEditMode({ world, selection, host: () => host });
assert(mode.editable() && !mode.active);
assert(mode.enter() && mode.active && mode.object === cube);
assert.deepEqual(mode.stats.faces, [24, 24], 'the selection the Mesh kept');
mode.module('mesh.select_all', { action: 'DESELECT' });
assert.deepEqual(mode.stats.faces, [0, 24]);
mode.setSelectMode('FACE');
assert.equal(mode.selectmode, 4, 'face select mode');
mode.module('mesh.select_all', { action: 'SELECT' });
assert.deepEqual(mode.stats.faces, [24, 24]);
assert(mode.gizmoStats(), 'the tools gizmo has a selection');
mode.addPrimitive('mesh.primitive_cube_add', { size: 0.5, location: [3, 0, 0] });
assert.equal(mode.stats.faces[1], 30, 'a primitive joins the edit mesh');
history.undo();
assert.equal(mode.stats.faces[1], 24);
assert(mode.exit() && !mode.active);
assert.equal(blender.mesh(sync.objectOf(cube)).faces_num, 24);
console.log("Edit Mode on Main: Blender's operators enter, edit and leave it, the view draws it, undo is Blender's edit-mode undo");
