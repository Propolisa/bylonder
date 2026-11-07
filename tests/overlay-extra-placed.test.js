// The extras overlay draws no empty axes for objects Blender draws otherwise (a lattice, a Grease Pencil object): Bike
// Ride's camera view showed long black axes lines across its frame, one per Grease Pencil object and lattice.
import assert from 'node:assert/strict';
import { FreeCamera, NullEngine, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { createExtrasOverlay } from '../src/draw/overlay-extra.js';

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 5, -10), scene);
const empty = new TransformNode('Empty', scene), lattice = new TransformNode('Lattice', scene), drawing = new TransformNode('Drawing', scene);
lattice.metadata = { wbType: 'LATTICE' };
drawing.metadata = { wbType: 'GREASEPENCIL' };
const overlay = createExtrasOverlay(scene, { objects: () => [empty, lattice, drawing] });
overlay.setEnabled(true);
scene.render();
const drawn = new Set(overlay.meshes.map((mesh) => mesh.metadata.extra.entry.node.name));
assert.deepEqual([...drawn].filter((name) => name !== 'Camera'), ['Empty'], 'only the empty draws its axes');
console.log('Extras overlay: no empty axes for lattices and Grease Pencil objects');
