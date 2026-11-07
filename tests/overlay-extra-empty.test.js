// The extras overlay draws a read file's empties by their Display As and Size, as Blender's overlay_extra does: Bike
// Ride's cube, circle and sphere empties drew as plain axes.
import assert from 'node:assert/strict';
import { FreeCamera, NullEngine, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { contextStruct, inPythonContext } from '../src/python/bpy_rna.js';
import { createExtrasOverlay } from '../src/draw/overlay-extra.js';

// A file with a Cube empty of size 0.5, made by Blender's own data API, then opened.
const main = new BlenderMain();
inPythonContext(main.C, () => {
  const C = contextStruct(), empty = C.blend_data.objects.new('Box', null);
  Object.assign(empty, { empty_display_type: 'CUBE', empty_display_size: 0.5 });
  C.scene.collection.objects.link(empty);
});
const bytes = main.writeBlend('/extras.blend');
const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 5, -10), scene);
const sync = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: createBlenderIDs(new BlenderMain()) });
const nodes = sync.readBlend(bytes, scene).nodes, box = nodes.find((n) => n.name === 'Box');
assert.ok(box instanceof TransformNode, 'the empty opened');
assert.deepEqual([box.metadata.empty_display_type, box.metadata.empty_display_size], ['CUBE', 0.5], "the empty's Display As and Size");

const overlay = createExtrasOverlay(scene, { objects: () => nodes });
overlay.setEnabled(true);
scene.render();
const shapes = (node) => overlay.meshes.filter((mesh) => mesh.metadata.extra.entry.node === node).map((mesh) => mesh.metadata.extra.shape);
assert.deepEqual(shapes(box), ['cube'], 'the empty draws as a cube');
console.log('Extras overlay: a read empty draws by its Display As');
