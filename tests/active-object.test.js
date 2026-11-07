// The active object is the view layer's (view_layer.objects.active), selected or not, as in Blender: Deselect All
// keeps it, a file whose active object is unselected opens with it active, and setting it selects nothing.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { contextStruct, inPythonContext, setContextPointer } from '../src/python/bpy_rna.js';
import { createSelection } from '../src/editors/object/selection.js';
import { sceneMain } from './scene-main.js';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';

const engine = new NullEngine(), scene = new Scene(engine);
const cube = MeshBuilder.CreateBox('Cube', { size: 2 }, scene), other = MeshBuilder.CreateBox('Other', { size: 1 }, scene);
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
other.metadata = { wbId: 'other', wbCreation: { operator: 'mesh.primitive_cube_add', options: { size: 1 } } };
const world = { scene, objects: Object.assign([cube, other], { scene }), animation: createAnimationModel() };
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const selection = createSelection(scene, world.objects);
const sync = sceneMain(world, selection), { blender } = sync;
setContextPointer(blender.C);
selection.replace([cube]);
sync.redraw();

// Blender's Deselect All leaves the active object active.
assert.equal(sync.run(() => blender.run('object.select_all', { action: 'DESELECT' })).status, OPERATOR_FINISHED);
assert.equal(selection.nodes.length, 0, 'nothing is selected');
assert.equal(selection.active?.name, 'Cube', 'the cube stays active');
const active = () => inPythonContext(blender.C, () => contextStruct().view_layer.objects.active?.name ?? null);
assert.equal(active(), 'Cube', "Main's active object too");

// Making another object active selects nothing.
sync.run(() => inPythonContext(blender.C, () => { contextStruct().view_layer.objects.active = contextStruct().scene.objects.get('Other'); }));
assert.equal(selection.active?.name, 'Other');
assert.equal(selection.nodes.length, 0, 'nothing is selected');
// A file whose active object is unselected opens with it active: read by a project's code (sdk.openBlend), then the
// scene's sync starts on what Main holds.
const bytes = sync.writeBlend('/active.blend');
const openedScene = new Scene(new NullEngine()), ids = createBlenderIDs(new BlenderMain());
const { nodes } = createMainSync({ rna: createRNA({ world: { scene: openedScene, objects: [] } }), ids }).readBlend(bytes, openedScene);
const opened = { scene: openedScene, objects: Object.assign([...nodes], { scene: openedScene }), animation: createAnimationModel(() => {}, { ids }) };
const openedSelection = createSelection(openedScene, opened.objects);
createMainSync({ rna: createRNA({ world: opened, selection: openedSelection }), ids });
assert.equal(openedSelection.active?.name, 'Other', 'the file opens with its active object');
assert.equal(openedSelection.nodes.length, 0, 'and nothing selected');
console.log('Active object: the view layer\'s, selected or not, through Deselect All and setting it');
