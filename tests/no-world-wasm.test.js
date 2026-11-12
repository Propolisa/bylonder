// A .blend whose scene has no World renders black behind its objects, as Blender's does: the page's own world is
// unlinked when the file is adopted (main-sync.js), so neither the app nor an export clears to Babylon's navy.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, sync, scene } = openExample('lava');
sync.view();
assert.equal(world.worlds.active(), null, 'no world is linked');
world.worlds.setViewportActive(true, true);
assert.deepEqual(scene.clearColor.asArray().slice(0, 3), [0, 0, 0], 'the rendered background is black');
const SCENE = JSON.parse(/const SCENE = (.*);/.exec((await exportModule(world))['scene.js'])[1]);
assert.deepEqual(SCENE.clearColor.slice(0, 3), [0, 0, 0], 'and so is the page');
console.log('No world: a .blend without a World renders black in the app and its exported page, as in Blender');
process.exit(0);
