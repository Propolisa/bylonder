// A Blender light's power as Babylon's intensity: a point light's radiant intensity (W / 4 pi), an area light's radiance
// as EEVEE converts it (eevee_light.cc shape_radiance_get: W / (pi * area), an ellipse's area pi / 4 of its rectangle).
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createLight } from '../src/blenkernel/light/light-home.js';

const scene = new Scene(new NullEngine());
const near = (a, b) => Math.abs(a - b) < 1e-6;
const point = createLight('Bulb', 'POINT', { energy: 100 }, scene);
assert.ok(near(point.intensity, 100 / (4 * Math.PI)), `point: ${point.intensity}`);
const square = createLight('Panel', 'AREA', { energy: 100, size: 1 }, scene);
assert.ok(near(square.intensity, 100 / Math.PI), `a 1 m square: ${square.intensity}`);
const ellipse = createLight('Oval', 'AREA', { energy: 100, shape: 'ELLIPSE', size: 2, size_y: 1 }, scene);
assert.ok(near(ellipse.intensity, 100 / (Math.PI * 2 * Math.PI / 4)), `a 2 by 1 m ellipse: ${ellipse.intensity}`);
// EEVEE fades a local light to nothing where its power falls to the scene's light threshold (eevee_light.cc
// attenuation_radius_get, light_influence_attenuation), as Babylon's glTF falloff does at a light's range: a 100 W
// white bulb reaches 10 m, one with a Custom Distance that far.
assert.ok(near(point.range, 10), `a 100 W bulb reaches ${point.range} m`);
assert.equal(createLight('Near', 'POINT', { energy: 100, use_custom_distance: true, cutoff_distance: 3 }, scene).range, 3);
assert.ok(near(createLight('Dim', 'POINT', { energy: 2 }, scene).range, Math.sqrt(2)), 'a 2 W bulb reaches 1.4 m');
console.log("Light power: points as radiant intensity, area lights as EEVEE's radiance passed");
