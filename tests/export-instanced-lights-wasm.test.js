// A light instanced by a collection (Link and Append's street lamps, linked from the example's library) lights the
// exported page at each instance, as in the app: the export writes each instance's light where it stands.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { sceneTable } from './export-package.js';

const { world, sync } = openExample('link-append');
sync.view();
const lights = sceneTable(await exportModule(world), 'LIGHTS');
const lamps = lights.filter((l) => l.name.endsWith('Instances') && l.isEnabled !== false);
assert.equal(lamps.length, 8, `each of the eight street lamps brings its light (${lights.map((l) => l.name).join(', ')})`);
assert.equal(new Set(lamps.map((l) => l.position.map((v) => v.toFixed(2)).join())).size, 8, 'each where its lamp stands');
console.log("Export instanced lights: a collection instance's light lights the page at each instance");
