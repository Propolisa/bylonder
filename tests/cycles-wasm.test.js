// Cycles as the side module cycles.wasm (src/render/cycles.js, src/port/side-modules.js): loaded into Blender's module
// on first use, its add-on enabled, and Blender's render operator rendering Window Light (examples/rendering) with it at
// a few samples into a Render Result read through the view transform (wasm/render-api.cc), as desktop Blender 5.2's
// Cycles renders it on the CPU (tools/blender-reference/cycles-window-light.py), and again the same.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Cycles renders on threads of its own (its session's).
process.env.BYLONDER_THREADS ??= '4';
const { blenderMain, blenderModule } = await import('../src/bmesh/bmesh-wasm.js');
await import('../src/python/bpy_interface.js');
const { pointerStruct, setContextPointer, structFind } = await import('../src/python/bpy_rna.js');
const { loadCycles } = await import('../src/render/cycles.js');

const { exports: x } = blenderModule;
const OPERATOR_FINISHED = 1 << 2;
const main = blenderMain();
setContextPointer(main.C);
main.readBlend(await readFile(new URL('../examples/rendering/rendering.blend', import.meta.url)));
await loadCycles();
// Every worker of the thread pool, spares too, loaded Cycles before the bytes it loads them from were freed (a page that
// rendered before reuses that memory at once).
const loads = new Int32Array(x.memory.buffer, x.side_modules_list() >>> 0, 1)[0];
assert.equal(loads, blenderModule.workers, `each of the pool's ${blenderModule.workers} workers loaded Cycles, not ${loads}`);
const scene = pointerStruct(structFind('Scene'), main.scene, main.scene);
scene.render.engine = 'CYCLES';
assert.equal(scene.render.engine, 'CYCLES', "Cycles' add-on registered its render engine");
Object.assign(scene.render, { resolution_x: 64, resolution_y: 48, resolution_percentage: 100 });
Object.assign(scene.cycles, { samples: 4, use_denoising: false });
// A render's pixels, as 8-bit RGBA in display space.
const size = x.malloc(8) >>> 0;
function render() {
  const { status, report } = main.run('render.render', {});
  assert.ok(status & OPERATOR_FINISHED, `render.render finished: status ${status}, ${report}`);
  assert.ok(x.render_result_size(main.scene, size), 'a render result');
  const [width, height] = new Int32Array(x.memory.buffer, size, 2);
  assert.deepEqual([width, height], [64, 48]);
  const pixels = x.malloc(width * height * 4) >>> 0;
  x.render_result_pixels(main.scene, pixels);
  const rgba = new Uint8Array(x.memory.buffer, pixels, width * height * 4).slice();
  x.free(pixels);
  return rgba;
}
const rgba = render(), count = rgba.length / 4;
// Lit, shaded and not blank: the pixels' brightness spreads.
const brightness = Array.from({ length: count }, (_, i) => rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]);
const mean = brightness.reduce((a, b) => a + b) / brightness.length;
const spread = Math.sqrt(brightness.reduce((a, b) => a + (b - mean) ** 2, 0) / brightness.length);
assert.ok(mean > 30 && spread > 20, `a lit, shaded image: mean ${mean.toFixed(0)}, spread ${spread.toFixed(0)}`);
// Desktop Blender's pixels for the same samples and seed: each channel's mean difference within a few levels.
const blender = await readFile(new URL('./fixtures/cycles/window-light-64x48.rgba', import.meta.url));
const differences = [0, 1, 2].map((c) => rgba.reduce((sum, v, i) => (i % 4 === c ? sum + Math.abs(v - blender[i]) : sum), 0) / count);
assert.ok(differences.every((d) => d < 2), `the render matches desktop Blender's: mean differences ${differences.map((d) => d.toFixed(2)).join(', ')} of 255`);
// Rendering again (F12 twice) renders the same image: its session's new thread starts clean on the memory the first freed.
for (let again = 0; again < 2; again++) assert.deepEqual(render(), rgba, 'a render again gives the same image');
x.free(size);
console.log(`Cycles renders Window Light as desktop Blender does, again too: mean differences ${differences.map((d) => d.toFixed(2)).join(', ')} of 255 per channel`);
process.exit(0);
