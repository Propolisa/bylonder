// A material that reads an attribute the mesh lacks (gaku's chairs read "Color.001") draws it as Blender's draw does an
// unbound vertex attribute, (0, 0, 0, 1), instead of failing the mesh's draw for want of a buffer; so does a curves mesh,
// for what its material's effect reads.
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, Scene, ShaderMaterial, FreeCamera, Vector3 } from '@babylonjs/core';
import { fillMissingAttributes as fillKinds, fillWhatItReads } from '../src/overrides/webgpu/missing-attributes.js';
import { attributeKind } from '../src/nodes/blender/attributes.js';

const fillMissingAttributes = (mesh, names) => fillKinds(mesh, names.map(attributeKind));

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

// A mesh whose buffers are not Blender's (curves) gets what its material's effect reads, once it compiles.
new FreeCamera('camera', new Vector3(0, 0, -5), scene);
const strands = MeshBuilder.CreateGround('Strands', {}, scene);
fillWhatItReads(strands);
strands.material = new ShaderMaterial('Hair', scene, { vertexSource: 'attribute vec3 position; attribute vec4 color; void main() { gl_Position = vec4(position, 1.0) + color; }',
  fragmentSource: 'void main() { gl_FragColor = vec4(1.0); }' }, { attributes: ['position', 'color'], uniforms: [] });
for (let i = 0; i < 20 && !strands.getVertexBuffer('color'); i++) { scene.render(); await new Promise((resolve) => setTimeout(resolve, 10)); }
assert.equal(strands.getVertexBuffer('color')?.getData().length, strands.getTotalVertices() * 4, "what the strands' material reads, per vertex");
console.log("Missing attributes: read as an unbound vertex attribute, (0, 0, 0, 1), also what a curves mesh's material reads");
