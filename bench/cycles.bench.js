// Cycles (the side module cycles.wasm) rendering Window Light (examples/rendering) as the example's own Cycles render
// does (24 samples, no denoising), at a resolution percentage, on the threads BYLONDER_THREADS gives it; with --png, the
// result is saved for comparison with desktop Blender's (tools/blender-reference/cycles-window-light.py).
// usage: BYLONDER_THREADS=n node bench/cycles.bench.js [percent] [--runs n] [--png file]
import { readFile, writeFile } from 'node:fs/promises';

process.env.BYLONDER_THREADS ??= '8';
const { blenderMain, blenderModule } = await import('../src/bmesh/bmesh-wasm.js');
await import('../src/python/bpy_interface.js');
const { pointerStruct, setContextPointer, structFind } = await import('../src/python/bpy_rna.js');
const { loadCycles } = await import('../src/render/cycles.js');
const { pngDataUrl } = await import('../src/imbuf/data-url.js');

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const percent = Number(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 25);
const runs = Number(option('--runs') ?? 1), png = option('--png');

const { exports: x } = blenderModule;
const main = blenderMain();
setContextPointer(main.C);
main.readBlend(await readFile(new URL('../examples/rendering/rendering.blend', import.meta.url)));
await loadCycles();
const scene = pointerStruct(structFind('Scene'), main.scene, main.scene);
scene.render.engine = 'CYCLES';
scene.render.resolution_percentage = percent;
Object.assign(scene.cycles, { samples: 24, use_denoising: false });

const times = [];
for (let run = 0; run < runs; run++) {
  const start = performance.now();
  const { status, report } = main.run('render.render', {});
  if (!(status & 4)) throw Error(`render.render: ${report}`);
  times.push(performance.now() - start);
  console.error(`run ${run + 1}: ${(times.at(-1) / 1000).toFixed(2)} s`);
}
const size = x.malloc(8) >>> 0;
x.render_result_size(main.scene, size);
const [width, height] = new Int32Array(x.memory.buffer, size, 2);
if (png) {
  const pixels = x.malloc(width * height * 4) >>> 0;
  x.render_result_pixels(main.scene, pixels);
  const url = pngDataUrl(new Uint8Array(x.memory.buffer, pixels, width * height * 4).slice(), width, height);
  await writeFile(png, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
}
const median = times.sort((a, b) => a - b)[runs >> 1];
console.log(`Window Light ${percent}% (${width}x${height}), 24 samples: ${(median / 1000).toFixed(2)} s (median of ${runs}), ${process.env.BYLONDER_THREADS} threads`);
process.exit(0);
