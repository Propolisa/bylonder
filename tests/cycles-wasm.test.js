// Cycles as the side module cycles.wasm (src/render/cycles.js, src/port/side-modules.js): loaded into Blender's module
// on first use, its add-on enabled, and Blender's render operator rendering Window Light (examples/rendering) with it at
// a few samples into a Render Result read through the view transform (wasm/render-api.cc).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';
import { loadCycles } from '../src/render/cycles.js';

const { exports: x } = blenderModule;
const main = blenderMain();
setContextPointer(main.C);
main.readBlend(await readFile(new URL('../examples/rendering/rendering.blend', import.meta.url)));
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
// Lit, shaded and not blank: the pixels' brightness spreads.
const brightness = Array.from({ length: width * height }, (_, i) => rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]);
const mean = brightness.reduce((a, b) => a + b) / brightness.length;
const spread = Math.sqrt(brightness.reduce((a, b) => a + (b - mean) ** 2, 0) / brightness.length);
assert.ok(mean > 30 && spread > 20, `a lit, shaded image: mean ${mean.toFixed(0)}, spread ${spread.toFixed(0)}`);
x.free(pixels);
x.free(size);
console.log('cycles ok');
process.exit(0);
