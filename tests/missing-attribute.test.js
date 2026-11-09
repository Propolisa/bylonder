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
const vertices = box.getTotalVertices();
assert.deepEqual([...buffer.getData()], Array.from({ length: vertices }, () => [0, 0, 0, 1]).flat(), '(0, 0, 0, 1) at every vertex');
assert.equal(buffer.getIsInstanced(), false, 'per vertex, which thin instances read on WebGPU too (it has no instance divisor)');
box.thinInstanceAddSelf();
box.thinInstanceAdd([box.getWorldMatrix(), box.getWorldMatrix()]);
assert.equal(box.getVertexBuffer(attributeKind('Color.001')).getData().length, vertices * 4, 'whatever the instance count');
MeshBuilder.CreateSphere('Seat', { segments: 4 }, scene).geometry.applyToMesh(box);
fillMissingAttributes(box, ['Color.001']);
assert.equal(box.getVertexBuffer(attributeKind('Color.001')).getData().length, box.getTotalVertices() * 4, 'refilled for new geometry');
box.setVerticesData(attributeKind('Col'), new Float32Array(box.getTotalVertices() * 4).fill(0.5), false, 4);
fillMissingAttributes(box, ['Col']);
assert.equal(box.getVerticesData(attributeKind('Col'))[0], 0.5, "an attribute the mesh has keeps its values");
console.log('Missing attributes: read as an unbound vertex attribute, (0, 0, 0, 1)');
