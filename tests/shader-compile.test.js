// A 3D Viewport draws a surface whose shader still compiles with Blender's default surface, as EEVEE does, and counts
// the shaders left; once compiled, the surface draws its own material again.
import assert from 'node:assert/strict';
import { FreeCamera, MeshBuilder, NullEngine, PBRMaterial, Scene, Vector3 } from '@babylonjs/core';
import { createShaderCompile } from '../src/draw/shader-compile.js';

const scene = new Scene(new NullEngine()), camera = new FreeCamera('Camera', new Vector3(0, 0, -5), scene);
const material = new PBRMaterial('Slow', scene), mesh = Object.assign(MeshBuilder.CreateSphere('Sphere', {}, scene), { material });
let compiling = true;
const isReady = material.isReadyForSubMesh.bind(material);
material.isReadyForSubMesh = (...args) => isReady(...args) && !compiling;
const compile = createShaderCompile(scene);

let drawn = compile.use(camera);
assert.equal(mesh.getMaterialForRenderPass(camera.renderPassId)?.name, '__defaultSurface', 'the default surface while compiling');
assert.equal(compile.queued, 1, 'one shader left');
assert.ok(mesh.material === material, 'the mesh keeps its material');
drawn();
assert.ok(!mesh.getMaterialForRenderPass(camera.renderPassId), 'put back once the view has rendered');

compiling = false;
for (let i = 0; i < 50; i++) {
  drawn = compile.use(camera);
  if (!mesh.getMaterialForRenderPass(camera.renderPassId)) break;
  drawn();
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(mesh.getMaterialForRenderPass(camera.renderPassId)?.name, undefined, 'its own material once compiled');
assert.equal(compile.queued, 0);
drawn();
compile.dispose();
console.log('Shader compile: the default surface and the shaders left while a material compiles passed');
