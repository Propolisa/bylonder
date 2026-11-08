// Material Preview's studio sun as EEVEE extracts it (sun_extraction): the light above the threshold is clamped out of
// the image and summed into a sun pointing at it, in the axes Babylon's cube and its spherical harmonics use.
import assert from 'node:assert/strict';
import { CubeMapToSphericalPolynomialTools, PanoramaToCubeMapTools, Vector3 } from '@babylonjs/core';
import { extractSun } from '../src/blenkernel/scene/world-sun.js';

const width = 64, height = 32, image = new Float32Array(width * height * 4).fill(0.5);
const spot = (8 * width + 40) * 4;
image.set([1000, 800, 600], spot);
const harmonicsOf = (data) => CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial(PanoramaToCubeMapTools.ConvertPanoramaToCubemap(Float32Array.from(data), width, height, 32, false, false));
const before = harmonicsOf(image), sun = extractSun(image, width, height, 10);

assert.ok(Math.abs(image[spot] - 10) < 1e-4 && Math.abs(image[spot + 1] - 8) < 1e-4, 'its brightest channel clamped to the threshold, its color kept');
assert.equal(image[0], 0.5, 'the rest left as it was');
const phi = (Math.PI * 8.5) / height, solidAngle = Math.sin(phi) * (Math.PI / height) * ((2 * Math.PI) / width);
assert.ok(Math.abs(sun.color.r - 990 * solidAngle) < 1e-4, 'the sun has what the clamp took, by its solid angle');
// What the clamp took, in the cube's spherical harmonics: its first band points where the sun does.
const after = harmonicsOf(image), taken = before.x.subtract(after.x);
const band = new Vector3(taken.x, before.y.x - after.y.x, before.z.x - after.z.x).normalize();
assert.ok(Vector3.Dot(band, sun.direction) > 0.99, `the sun points where its light was (${band}, ${sun.direction})`);
console.log('World sun: the light above the threshold is clamped out of the studio light and lit as a sun pointing at it');
