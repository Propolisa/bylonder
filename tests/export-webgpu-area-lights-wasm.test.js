// An exported page whose PBR materials an area light lights compiles on WebGPU: every PBR material marks Babylon's area
// light function for inlining (overrides/webgpu/samplers.js, which a WebGPU page imports), as WebGPU's GLSL takes no
// sampler as a function's argument, where glslang rejected the shader ("sampler constructor must appear at point of
// use") and the page stayed black. Rigged Character's materials are PBR and its key light is an area light.
import assert from 'node:assert/strict';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { createCompilers, WebGPUShaderEngine } from './webgpu-shaders.js';

const { world, sync } = openExample('rigged-character');
sync.view();
const files = await exportModule(world);
const written = writePackage(files), engine = new WebGPUShaderEngine(await createCompilers());
Object.assign(engine, { _compileRawShaderToSpirV: (s) => s, _createPipelineStageDescriptor: () => ({}) });
const { scene } = await (await import(written.url)).load(engine);
const pbr = scene.materials.filter((m) => m.getClassName() === 'PBRMaterial');
assert.ok(pbr.length && pbr.every((m) => m.pluginManager?.getPlugin('BlenderAreaLightInline')), 'every PBR material marks the area light function for inlining');
written.remove();
console.log('WebGPU area lights: an exported page with area-lit PBR materials inlines the area light function on WebGPU');
process.exit(0);
