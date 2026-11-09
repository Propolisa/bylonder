// On WebGPU, Babylon's PBR and Standard materials compile from GLSL, so Bylonder's GLSL plugins on them attach: curves
// strands, point clouds and the Dithered render method draw there as on WebGL 2.
import assert from 'node:assert/strict';
import { NullEngine, Scene, PBRMaterial, StandardMaterial } from '@babylonjs/core';
import { pbrFromGLSL } from '../src/overrides/webgpu/pbr-from-glsl.js';
import { CurvesPlugin } from '../src/draw/curves.js';
import { PointCloudPlugin } from '../src/draw/pointcloud.js';

const engine = new NullEngine();
Object.defineProperty(engine, 'isWebGPU', { value: true });
const scene = new Scene(engine);
assert.equal(new PBRMaterial('native', scene).shaderLanguage, 1, "Babylon's default on WebGPU: WGSL");
assert.equal(CurvesPlugin.of(new PBRMaterial('native curves', scene)), null, 'no GLSL plugin on a WGSL material');

pbrFromGLSL();
for (const material of [new PBRMaterial('pbr', scene), new StandardMaterial('standard', scene, true)]) {
  assert.equal(material.shaderLanguage, 0, `${material.getClassName()} compiles from GLSL`);
  assert.ok(CurvesPlugin.draws(material), `${material.getClassName()} draws curves`);
  assert.ok(PointCloudPlugin.of(material), `${material.getClassName()} draws point clouds`);
}
console.log('WebGPU materials: PBR and Standard compile from GLSL, so curves, point clouds and Dithered draw on WebGPU');
