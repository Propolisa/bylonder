// The Dithered and light probe plugins' uniforms are in the material's uniform block, not a uniform buffer of their
// own (a WebGPU stage has at most 12), and stay right per draw: one material drawn on two meshes with other values
// within a frame uploads each draw's values to a buffer of its own.
import assert from 'node:assert/strict';
import { FreeCamera, MeshBuilder, PBRMaterial, Scene, Vector3 } from '@babylonjs/core';
import { compilersPresent, createCompilers, WebGPUShaderEngine } from './webgpu-shaders.js';
import { blenderDitheredPBR } from '../src/blenkernel/material/dithered-pbr.js';
import { blenderLightProbes } from '../src/draw/light-probe-pbr.js';
import { setDitherOffset } from '../src/render/dither.js';
import { pbrFromGLSL } from '../src/overrides/webgpu/pbr-from-glsl.js';

if (!compilersPresent()) {
  console.log('Plugin uniforms in the material block: skipped, no public/webgpu compilers (npm run dev or npm run build fetches them)');
  process.exit(0);
}
pbrFromGLSL();
const engine = new WebGPUShaderEngine(await createCompilers());
engine._features.trackUbosInFrame = true;
const uploads = [];
engine.setTexture = () => {};
engine.updateUniformBuffer = (buffer, data) => uploads.push({ buffer, data: Float32Array.from(data) });
const scene = new Scene(engine);
new FreeCamera('Camera', new Vector3(0, 0, -5), scene);
const material = blenderLightProbes(blenderDitheredPBR(new PBRMaterial('Principled', scene)));
const meshes = ['A', 'B'].map((name, i) => Object.assign(MeshBuilder.CreateSphere(name, {}, scene), { material, position: new Vector3(i * 2, 0, 0) }));
for (let i = 0; i < 300 && !meshes.every((mesh) => material.isReadyForSubMesh(mesh, mesh.subMeshes[0])); i++) await new Promise((resolve) => setTimeout(resolve, 10));
assert.ok(meshes.every((mesh) => material.isReadyForSubMesh(mesh, mesh.subMeshes[0])), 'the material compiles on WebGPU');

const effect = meshes[0].subMeshes[0].effect, block = material._uniformBuffer;
assert.ok(!effect.getUniformNames().includes('LeftOver') && !/uniform\s+LeftOver/.test(effect._fragmentSourceCode ?? ''), 'no uniform buffer of their own');
const at = block._uniformLocations.bl_dither_offset;
assert.ok(at !== undefined && block._uniformLocations.blProbeOffset !== undefined, 'in the material block');

// One frame, two draws of the material with other dither offsets.
engine.endFrame();
uploads.length = 0;
for (const [mesh, offset] of [[meshes[0], 0.25], [meshes[1], 0.75]]) {
  setDitherOffset(scene, offset);
  material.bindForSubMesh(mesh.getWorldMatrix(), mesh, mesh.subMeshes[0]);
}
const drawn = uploads.filter(({ buffer }) => block._buffers.some(([b]) => b === buffer));
assert.deepEqual(drawn.map(({ data }) => data[at]), [0.25, 0.75], 'each draw uploads its own offset');
assert.notEqual(drawn[0].buffer, drawn[1].buffer, 'to a buffer of its own');
console.log('Plugin uniforms in the material block: no uniform buffer of their own, each draw with its own values');
