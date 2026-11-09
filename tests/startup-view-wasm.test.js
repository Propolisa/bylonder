// The Default Cube (examples/cube, Bylonder's startup scene) shows its scene through the view settings of Blender's own
// startup file, as the module reads it: AgX, no look, exposure 0, gamma 1.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct } from '../src/python/bpy_rna.js';
import { renderDefaults } from '../src/blenkernel/scene/render.js';
import { looks } from '../src/blenkernel/scene/render-babylon.js';

const startup = idStruct(blenderMain().scene).view_settings;
const cube = readFileSync(new URL('../examples/cube/index.js', import.meta.url), 'utf8');
const viewTransform = cube.match(/viewTransform: '([^']+)'/)?.[1];
assert.equal(viewTransform, startup.view_transform, "the Default Cube's view transform is startup.blend's");
assert.equal(looks[renderDefaults.viewSettings.look][0], startup.look, 'its look');
assert.equal(renderDefaults.viewSettings.exposure, startup.exposure, 'its exposure');
assert.equal(renderDefaults.viewSettings.gamma, startup.gamma, 'its gamma');
console.log("Startup view: the Default Cube shows through startup.blend's view settings");
