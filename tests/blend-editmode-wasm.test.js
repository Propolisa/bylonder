// A file saved in Edit Mode opens in Edit Mode, as Blender's file read enters the modes objects were saved in
// (wm_file_read_post, ED_editors_init): the mesh has its edit mesh again and draws in Edit Mode.
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createSelection } from '../src/editors/object/selection.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { sceneMain } from './scene-main.js';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createHistory } from '../src/editors/undo/storage.js';

function sceneWith(objects) {
  const scene = new Scene(new NullEngine());
  objects.scene = scene;
  const world = { scene, objects };
  world.collections = createCollections(world);
  return world;
}

// Saved: the cube in Edit Mode.
const saved = sceneWith([]);
const cube = buildMesh(saved.scene, 'Cube', { operator: 'mesh.primitive_cube_add', options: {} });
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
saved.objects.push(cube);
const selection = createSelection(saved.scene, saved.objects);
selection.replace([cube]);
const sync = sceneMain(saved, selection);
createHistory(saved.objects, () => {}, { main: sync });
const entered = sync.run(() => sync.blender.run('object.editmode_toggle'));
assert.equal(entered.status, OPERATOR_FINISHED, entered.report);
const bytes = sync.writeBlend('/editmode.blend');

// Opened in a scene of its own, as a project's code opens it (sdk.openBlend).
const scene = new Scene(new NullEngine());
const ids = createBlenderIDs(new BlenderMain());
const reader = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids });
const { nodes } = reader.readBlend(bytes, scene);
const node = nodes.find((n) => n.name === 'Cube');
assert.equal(reader.blender.mode(reader.objectOf(node)), 'EDIT', 'the cube opens in Edit Mode');
assert.equal(node.metadata.wbMode, 'EDIT', 'and the view has it in Edit Mode, which syncing to Main keeps');
assert.ok(reader.blender.editMesh(reader.objectOf(node)), 'with its edit mesh');
assert.ok(scene.meshes.some((mesh) => mesh.parent === node && mesh.metadata?.overlay), 'the edit overlay is drawn');
// The scene's sync adopts what the project's code read: still one overlay.
const objects = Object.assign([...nodes], { scene });
createMainSync({ rna: createRNA({ world: { scene, objects, animation: createAnimationModel(() => {}, { ids }) }, selection: createSelection(scene, objects) }), ids });
assert.equal(scene.meshes.filter((mesh) => mesh.parent === node && mesh.name.endsWith('edit faces')).length, 1, 'one edit overlay');
console.log('Open: a file saved in Edit Mode opens in Edit Mode, as in Blender');
