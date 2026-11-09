// An area light that casts shadows in the app (Chess Endgame's Rim, Bylonder's Area Light Shadows extension) casts them
// in its exported page too: the page ships the extension's light (runtime/area-light.js), which Babylon's RectAreaLight,
// having no shadows, cannot stand in for.
import assert from 'node:assert/strict';
import { NullEngine, ShadowGenerator } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { AreaLight } from '../src/blenkernel/light/area-light.js';

const { world, sync, scene } = openExample('chess');
sync.view();
const rim = scene.lights.find((l) => l.name === 'Rim'), lamp = scene.lights.find((l) => l.name === 'Lamp');
assert.ok(rim instanceof AreaLight, 'the app draws the area light as one that casts shadows');
world.shadows = { setActive() {}, generators: [new ShadowGenerator(512, lamp), new ShadowGenerator(512, rim)] };
const files = await exportModule(world);
assert.ok(files['scene.js'].includes("from './bylonder-area-light.js'"), 'the page imports the area light');
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const pageRim = blend.scene.getLightByName('Rim');
assert.ok(blend.scene.getLightByName('Lamp').getShadowGenerator(), "the spot light's shadows are exported");
assert.ok(pageRim.getShadowGenerator() && pageRim.needCube?.(), 'the area light casts its shadows from a cube');
blend.dispose();
written.remove();
console.log('Export: an area light casts its shadows in the page as in the app');
process.exit(0);
