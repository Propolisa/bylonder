// A material that reads an attribute the mesh lacks (gaku's chairs read "Color.001") draws it as Blender's draw does an
// unbound vertex attribute, (0, 0, 0, 1), instead of failing the mesh's draw for want of a buffer.
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, Scene } from '@babylonjs/core';
import { fillMissingAttributes } from '../src/draw/mesh-batch-cache.js';
import { attributeKind } from '../src/nodes/blender/attributes.js';

const scene = new Scene(new NullEngine());
const box = MeshBuilder.CreateBox('Chair', {}, scene);
fillMissingAttributes(box, ['Color.001']);
const buffer = box.getVertexBuffer(attributeKind('Color.001'));
assert.deepEqual([...buffer.getData()], [0, 0, 0, 1], 'one value, (0, 0, 0, 1)');
assert.ok(buffer.getIsInstanced() && buffer.getInstanceDivisor() >= 2 ** 30, 'which every vertex reads');
box.setVerticesData(attributeKind('Col'), new Float32Array(box.getTotalVertices() * 4).fill(0.5), false, 4);
fillMissingAttributes(box, ['Col']);
assert.equal(box.getVerticesData(attributeKind('Col'))[0], 0.5, "an attribute the mesh has keeps its values");
console.log('Missing attributes: read as an unbound vertex attribute, (0, 0, 0, 1)');
