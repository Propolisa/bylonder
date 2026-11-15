// Cycles as the side module cycles.wasm (src/render/cycles.js, src/port/side-modules.js): loaded into Blender's module
// on first use, its add-on enabled, and Blender's render operator rendering the startup scene (its cube, light and
// camera) with it at a few samples into a Render Result read through the view transform (wasm/render-api.cc).
import assert from 'node:assert/strict';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';
import { loadCycles } from '../src/render/cycles.js';

const { exports: x } = blenderModule;
const main = blenderMain();
setContextPointer(main.C);
await loadCycles();
const scene = pointerStruct(structFind('Scene'), main.scene, main.scene);
scene.render.engine = 'CYCLES';
assert.equal(scene.render.engine, 'CYCLES', "Cycles' add-on registered its render engine");
Object.assign(scene.render, { resolution_x: 64, resolution_y: 48, resolution_percentage: 100 });
scene.cycles.samples = 4;
const { status, report } = main.run('render.render', {});
assert.ok(status & 1, `render.render finished: ${report}`);

const size = x.malloc(8) >>> 0;
assert.ok(x.render_result_size(main.scene, size), 'a render result');
const [width, height] = new Int32Array(x.memory.buffer, size, 2);
assert.deepEqual([width, height], [64, 48]);
const pixels = x.malloc(width * height * 4) >>> 0;
x.render_result_pixels(main.scene, pixels);
const rgba = new Uint8Array(x.memory.buffer, pixels, width * height * 4).slice();
const at = (u, v) => rgba.subarray((Math.floor(v * height) * width + Math.floor(u * width)) * 4).slice(0, 3);
// The lit cube in the middle is brighter than the world's grey at the corner.
const brightness = (rgb) => rgb[0] + rgb[1] + rgb[2];
assert.ok(brightness(at(0.5, 0.5)) > brightness(at(0.02, 0.98)), `the cube shows: ${at(0.5, 0.5)} against ${at(0.02, 0.98)}`);
x.free(pixels);
x.free(size);
console.log('cycles ok');
process.exit(0);
