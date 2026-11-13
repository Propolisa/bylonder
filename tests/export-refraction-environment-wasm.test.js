// A refracting material in an exported page compiles once the world's environment arrives: Babylon's refraction block
// declares its samplers only for an environment present at the build, while its define follows the scene's, so a
// material built before the environment (Snow's cornea) failed to compile ("blenderrefractionCubeSampler" undeclared)
// until the page built it again. The scene is tests/fixtures/refraction-environment.blend, written by
// tools/blender-reference/refraction-environment-fixture.py.
import assert from 'node:assert/strict';
import { BaseTexture, NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample(new URL('./fixtures/refraction-environment.blend', import.meta.url));
sync.view();
const written = writePackage(await exportModule(world));
const { scene } = await (await import(written.url)).load(new NullEngine());
scene.environmentTexture = null;
const cornea = scene.getMaterialByName('Cornea'), refraction = cornea.getBlockByPredicate((b) => b.getClassName() === 'RefractionBlock');
assert.ok(refraction, 'the cornea refracts through a refraction block');
const built = async () => {
  for (let i = 0; i < 200 && !cornea._buildWasSuccessful; i++) await new Promise((r) => setTimeout(r, 10));
  return cornea._fragmentCompilationState._builtCompilationString;
};
cornea.build();
assert.doesNotMatch(await built(), new RegExp(`samplerCube ${refraction._cubeSamplerName}`), 'built without an environment, no refraction sampler');
scene.environmentTexture = Object.assign(new BaseTexture(scene), { isCube: true });
const code = await built(), uses = code.split(refraction._cubeSamplerName).length - 1;
assert.ok(uses > 1 && code.includes(`samplerCube ${refraction._cubeSamplerName}`), `with the environment, the sampler it reads is declared (${uses} uses)`);
written.remove();
console.log('Refraction environment: a refracting material builds again as the environment arrives, its sampler declared');
process.exit(0);
