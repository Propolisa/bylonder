// EEVEE's first-band spherical harmonics and irradiance atlas as the page computes them (src/draw/spherical-harmonics.js,
// volume-probe-atlas.js): a uniform sky encodes to the Lambertian radiance it gives, rotation, the triple product with
// full visibility and deringing keep EEVEE's identities, and a loaded grid samples back what it baked.
import assert from 'node:assert/strict';
import { shNew, shEncode, shEvaluateLambert, shRotate, shTripleProduct, shDering, L0, MN1, M0, MP1 } from '../src/draw/spherical-harmonics.js';
import { buildAtlas, describeGrid, sampleNoBias, gridSamplePosition } from '../src/draw/volume-probe-atlas.js';

const close = (a, b, eps = 1e-3, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} != ${b}`);

// The sphere integrated over a Fibonacci set of directions, each weighted by its solid angle (encode_signal_sample).
function project(radiance, n = 4096) {
  const sh = shNew();
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - z * z), phi = i * Math.PI * (3 - Math.sqrt(5));
    const dir = [r * Math.cos(phi), r * Math.sin(phi), z];
    shEncode(sh, dir, radiance(dir).map((v) => v * (4 * Math.PI / n)));
  }
  return sh;
}
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// A uniform sky of radiance 1 lights a white Lambertian surface to radiance 1 facing any way (evaluate_lambert's 1/pi).
const uniform = project(() => [1, 1, 1, 1]);
close(uniform[L0], 4 * Math.PI * 0.282094792, 1e-3, 'L0');
for (const n of AXES) shEvaluateLambert(uniform, n).forEach((v) => close(v, 1, 1e-3, 'uniform'));

// Light from +X: brightest facing +X, darkest facing away; L1 Mp1 negative (EEVEE's basis is -x).
const fromX = project(([x]) => (x > 0 ? [x, x, x, 0] : [0, 0, 0, 0]));
assert.ok(fromX[MP1] < 0 && Math.abs(fromX[MN1]) < 1e-3 && Math.abs(fromX[M0]) < 1e-3);
assert.ok(shEvaluateLambert(fromX, [1, 0, 0])[0] > shEvaluateLambert(fromX, [0, 0, 1])[0]);
assert.ok(shEvaluateLambert(fromX, [0, 0, 1])[0] > shEvaluateLambert(fromX, [-1, 0, 0])[0]);

// A quarter turn about Z takes light from +X to light from +Y.
const quarter = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
const fromY = project(([, y]) => (y > 0 ? [y, y, y, 0] : [0, 0, 0, 0])), turned = shRotate(quarter, fromX);
for (let i = 0; i < 16; i++) close(turned[i], fromY[i], 1e-3, `rotate ${i}`);

// The triple product with full visibility (the constant 1) is the identity.
const visible = project(() => [1, 1, 1, 1]), product = shTripleProduct(visible, fromX);
for (let i = 0; i < 16; i++) close(product[i], fromX[i], 1e-3, `triple ${i}`);

// Deringing keeps a pure first band from going negative and leaves a gentle one alone.
const ringing = shNew();
ringing[L0] = ringing[L0 + 1] = ringing[L0 + 2] = 0.1;
ringing[MP1] = ringing[MP1 + 1] = ringing[MP1 + 2] = -1;
const deringed = shDering(ringing);
for (const n of AXES) assert.ok(0.282094792 * deringed[0] + (2 / 3) * (-0.488602512 * n[0] * deringed[MP1]) >= -1e-6, 'dering');
assert.deepEqual(Array.from(shDering(uniform)), Array.from(uniform));

// A 3 x 3 x 3 grid baked to the same light everywhere, all valid and fully hidden from the world, samples back that light
// at its centre and between its samples, times the probe's intensity (the padding's distant light weighs a little
// everywhere: grid_bias_sample_coord's 0.001).
const size = [3, 3, 3], n = 27, rgb = (coef) => Float32Array.from({ length: n * 3 }, () => uniform[coef]);
const cache = { size, irradiance: [rgb(L0), rgb(MN1), rgb(M0), rgb(MP1)], visibility: [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)], validity: new Uint8Array(n).fill(255) };
const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1];
const grid = { ...describeGrid({ matrix, size, settings: { intensity: 2 } }), cache };
const world = project(() => [5, 5, 5, 0]), atlas = buildAtlas([grid], world);
assert.equal(atlas.count, 2);
for (const P of [[1, 2, 3], [1.5, 2.5, 2.4], gridSamplePosition(grid.objectToWorld, size, [0, 2, 1])]) {
  const sampled = sampleNoBias(atlas, P, 0);
  shEvaluateLambert(sampled, [0, 0, 1]).slice(0, 3).forEach((v) => close(v, 2, 1e-2, `grid at ${P}`));
}
// Outside every grid: the world.
shEvaluateLambert(sampleNoBias(atlas, [40, 0, 0], 0), [0, 0, 1]).slice(0, 3).forEach((v) => close(v, 5, 2e-3, 'world'));
console.log('light probe harmonics ok');

// The world's light as Babylon's environment holds it (its spherical polynomial, in Babylon's axes) in EEVEE's harmonics
// (Blender's axes): a uniform sky lights every way alike, a bright up face (Babylon's +Y) lights what faces Blender's +Z
// and a bright front face (Babylon's +Z) what faces Blender's +Y.
const { CubeMapToSphericalPolynomialTools, Matrix, Constants } = await import('@babylonjs/core');
const { worldHarmonics } = await import('../src/draw/light-probes.js');
const scene = { iblIntensity: 1, useRightHandedSystem: false };
const environment = (bright) => {
  const face = (name) => Float32Array.from({ length: 4 * 4 * 4 }, (_, i) => (i % 4 === 3 ? 1 : name === bright ? 4 : 1));
  const polynomial = CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial({
    size: 4, right: face('right'), left: face('left'), up: face('up'), down: face('down'), front: face('front'), back: face('back'),
    format: Constants.TEXTUREFORMAT_RGBA, type: Constants.TEXTURETYPE_FLOAT, gammaSpace: false });
  return { sphericalPolynomial: polynomial, getReflectionTextureMatrix: () => Matrix.Identity(), invertZ: false, level: 1 };
};
const sky = worldHarmonics(scene, environment(null));
for (const n of AXES) shEvaluateLambert(sky, n).slice(0, 3).forEach((v) => close(v, 1, 0.02, 'uniform environment'));
const brightest = (sh) => AXES.map((n) => shEvaluateLambert(sh, n)[0]).reduce((best, v, i, all) => (v > all[best] ? i : best), 0);
assert.equal(AXES[brightest(worldHarmonics(scene, environment('up')))].join(), '0,0,1', 'Babylon up is Blender +Z');
assert.equal(AXES[brightest(worldHarmonics(scene, environment('front')))].join(), '0,1,0', 'Babylon front is Blender +Y');
console.log('world harmonics ok');

// Validity and dilation (eevee_lightprobe_volume_load.bsl.hh): a sample inside a closed single-sided box sees its back
// faces, is invalid, and takes its light from its valid neighbours; a thin double-sided plane between samples leaves
// them valid, each keeping its own side's light.
const grid3 = (light, validity) => {
  const n = 27, rgbOf = (coef) => Float32Array.from({ length: n * 3 }, (_, i) => (coef === L0 ? light(Math.floor(i / 3)) : 0));
  const cache = { size: [3, 3, 3], irradiance: [rgbOf(L0), rgbOf(MN1), rgbOf(M0), rgbOf(MP1)], visibility: [0, 1, 2, 3].map(() => new Float32Array(n)), validity: Uint8Array.from({ length: n }, (_, i) => validity(i)) };
  return buildAtlas([{ ...describeGrid({ matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1], size: [3, 3, 3], settings: {} }), cache }], shNew());
};
const at = (x, y, z) => (z * 3 + y) * 3 + x, CENTER = at(1, 1, 1);
const lambert = (atlas, P) => shEvaluateLambert(sampleNoBias(atlas, P, 0), [0, 0, 1])[0];
// The box: the centre sample sees only its back faces (validity 0) and holds no light; its neighbours hold L0 = 1.
const box = grid3((i) => (i === CENTER ? 0 : 1), (i) => (i === CENTER ? 0 : 255));
close(lambert(box, [0, 0, 0]), 0.282094792, 2e-3, 'the invalid centre takes its neighbours light');
// The thin plane: the samples below z = 0 hold 1, above 2, all valid: each side keeps its own light.
const plane = grid3((i) => (Math.floor(i / 9) < 1 ? 1 : 2), () => 255);
close(lambert(plane, gridSamplePosition(plane.grids[0].objectToWorld, [3, 3, 3], [1, 1, 0])), 0.282094792, 2e-3, 'below the plane');
close(lambert(plane, gridSamplePosition(plane.grids[0].objectToWorld, [3, 3, 3], [1, 1, 2])), 2 * 0.282094792, 2e-3, 'above the plane');
console.log('validity and dilation ok');

// The bake's projection pass leaves the depth test on: Babylon's effect renderer turns it off, and a shadow map drawn
// next would keep only its last caster.
{
  const { NullEngine, Scene, EffectRenderer, EffectWrapper, RenderTargetTexture } = await import('@babylonjs/core');
  const { drawRow } = await import('../src/draw/light-probes.js');
  const engine = new NullEngine(), scene = new Scene(engine);
  const renderer = new EffectRenderer(engine), output = new RenderTargetTexture('rows', { width: 4, height: 6 }, scene);
  const wrapper = new EffectWrapper({ engine, name: 'row', fragmentShader: 'void main(void) { gl_FragColor = vec4(1.0); }', useShaderStore: false });
  engine.depthCullingState.depthTest = true;
  let bound = false;
  drawRow(renderer, wrapper, output, 1, 2, 1, () => { bound = true; });
  assert.ok(bound, 'the pass binds its inputs');
  assert.equal(engine.depthCullingState.depthTest, true, 'and leaves the depth test on');
}
