// A Principled BSDF drawn as a PBRMaterial takes the Dithered render method's plugin (dithered-pbr.js) and the light
// probes' (light-probe-pbr.js), whose GLSL both bring Blender's functions: composed on one material, each function is
// defined once.
import assert from 'node:assert/strict';
import { FreeCamera, MeshBuilder, NullEngine, PBRMaterial, Scene, Vector3 } from '@babylonjs/core';
import { blenderDitheredPBR } from '../src/blenkernel/material/dithered-pbr.js';
import { blenderLightProbes } from '../src/draw/light-probe-pbr.js';
import { guardedDefinitions } from '../src/nodes/blender/glsl.js';

// The guard keeps a definition brought twice once, as the preprocessor reads it.
const twice = guardedDefinitions([['bl_f', 'float bl_f() { return 1.0; }']]).repeat(2);
assert.equal(twice.match(/^#ifndef BL_DEFINED_bl_f$/gm).length, 2);
assert.equal(twice.match(/^#define BL_DEFINED_bl_f$/gm).length, 2);

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 0, -5), scene);
const material = blenderLightProbes(blenderDitheredPBR(new PBRMaterial('Principled', scene)));
const mesh = Object.assign(MeshBuilder.CreateSphere('Sphere', {}, scene), { material });
for (let i = 0; i < 50 && !mesh.subMeshes[0].effect?.isReady(); i++) {
  scene.render();
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const fragment = mesh.subMeshes[0].effect._fragmentSourceCode;
assert.ok(fragment, 'the fragment shader is built');
// What the preprocessor keeps of the guards: a guarded block whose guard an earlier one defined is left out (other
// conditionals are kept whole).
const kept = (source) => {
  const defined = new Set(), out = [], stack = [];
  for (const line of source.split('\n')) {
    const guard = /^\s*#ifndef (BL_DEFINED_\w+)/.exec(line);
    if (guard || /^\s*#if/.test(line)) stack.push(!!guard && defined.has(guard[1]));
    else if (/^\s*#endif/.test(line)) stack.pop();
    if (stack.some(Boolean)) continue;
    const define = /^\s*#define (BL_DEFINED_\w+)/.exec(line);
    if (define) defined.add(define[1]);
    out.push(line);
  }
  return out.join('\n');
};
const code = kept(fragment);
for (const signature of ['vec4 bl_pcg4d(vec4', 'float bl_square(float', 'bool bl_grid_local_coord(', 'vec3 bl_grid_bias_sample_coord(']) {
  assert.equal(code.split('\n').filter((line) => line.startsWith(signature)).length, 1, `${signature} defined once`);
}
assert.match(code, /bl_probe_capture_visibility/, 'the light probes code is in');
assert.match(code, /bl_dither\(/, "the dithered plugin's code is in");
console.log('light probes and dithered PBR plugins compose');
