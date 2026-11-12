// An exported page compiles its shaders with one frame drawn as load() returns, within the engine's frame: WebGPU
// submits a frame's commands at its end, and a frame drawn outside one went with a later frame to an expired canvas
// texture, leaving every page black on WebGPU (checked in Chrome: .shots/lights/webgpu/user-before.png, -after.png).
import assert from 'node:assert/strict';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('framed-print');
sync.view();
const source = (await exportModule(world, { live: true }))['scene.js'];
const body = source.slice(source.indexOf('async function shadersCompiled'), source.indexOf('\n}', source.indexOf('async function shadersCompiled')));
const at = (text) => body.indexOf(text);
assert.ok(at('scene.render(') > 0, 'load() draws a frame');
assert.ok(at('beginFrame()') > 0 && at('beginFrame()') < at('scene.render(') && at('scene.render(') < at('endFrame()'), "within the engine's frame");
console.log("Export: an exported page's first frame is drawn within the engine's frame");
