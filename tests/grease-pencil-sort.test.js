// Grease Pencil objects draw back to front as whole objects, as Blender's gpencil_object_cache_sort orders them: each
// object's layers stay together whatever their index, and objects at one depth keep their order. Sorting by layer
// index alone interleaved Bike Ride's rider's objects, hiding her outlines under other objects' fills and making her
// overlapping legs flicker.
import assert from 'node:assert/strict';
import { FreeCamera, Mesh, NullEngine, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { greasePencilSortCompare, greasedLineMaterial } from '../src/draw/grease-pencil.js';

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', Vector3.Zero(), scene).setTarget(new Vector3(0, 0, 1));
scene.render();
const owner = (name, z) => Object.assign(new TransformNode(name, scene), { position: new Vector3(0, 0, z) });
const drawing = (of, layer) => {
  const mesh = Object.assign(new Mesh(`${of.name} ${layer}`, scene), { alphaIndex: layer, metadata: { drawOwner: of, greasePencil: true } });
  mesh.freezeWorldMatrix(of.computeWorldMatrix(true));
  return { getMesh: () => mesh, _alphaIndex: layer, _distanceToCamera: 0 };
};
const sorted = (...drawings) => drawings.sort(greasePencilSortCompare(scene)).map((d) => d.getMesh().name);

const far = owner('Far', 10), near = owner('Near', 5);
assert.deepEqual(sorted(drawing(near, 0), drawing(far, 30), drawing(near, 9), drawing(far, 3)), ['Far 3', 'Far 30', 'Near 0', 'Near 9'],
  'the farther object first, each in its layer order');
const left = owner('Left leg', 7), right = owner('Right leg', 7);
assert.deepEqual(sorted(drawing(right, 1), drawing(left, 20), drawing(right, 12), drawing(left, 2)), ['Left leg 2', 'Left leg 20', 'Right leg 1', 'Right leg 12'],
  'objects at one depth in their order, never interleaved');
// Strokes blend as fills do, so they sort among them; a stroke in the opaque pass drew under every fill.
assert.equal(greasedLineMaterial(scene, 'Strokes', false).needAlphaBlending(), true, 'strokes draw in the transparent pass');
console.log('Grease Pencil sort: whole objects back to front, ties in object order, layers in order, strokes with the fills');
