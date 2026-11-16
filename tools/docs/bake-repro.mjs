// Repro of the Cycles thread failures (docs/notes/cycles-thread-failures.md): Bake Lightmaps of Meditation's objects in
// Node, each bake as Blender's job or by its exec, with each step's start, the module's memory growth and the time.
//   node tools/docs/bake-repro.mjs [objects] [--job] [--samples N] [--repeat N]
//   objects: comma-separated (default Room,Turtle,Cushion,Bench,Bowl,Mannequin, the order meditation.py bakes them)
//   BYLONDER_THREADS: the module's threads (default 8)
import { readFile } from 'node:fs/promises';

process.env.BYLONDER_THREADS ??= '8';
const args = process.argv.slice(2), option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const names = (args[0] && !args[0].startsWith('--') ? args[0] : 'Room,Turtle,Cushion,Bench,Bowl,Mannequin').split(',');
const asJob = args.includes('--job'), samples = Number(option('--samples', 64)), repeat = Number(option('--repeat', 1));

const { blenderMain, blenderModule } = await import('../../src/bmesh/bmesh-wasm.js');
await import('../../src/python/bpy_interface.js');
const { setContextPointer } = await import('../../src/python/bpy_rna.js');
await import('../../src/io_scene_babylon/lightmaps.js');
const { bakeLightmaps } = await import('../../src/render/bake-lightmaps.js');
const { registerRuntimeTypes } = await import('../../src/runtimes/runtimes.js');
const { bylonderIcon } = await import('../../src/python/bpy_icons.js');

registerRuntimeTypes(bylonderIcon());
const main = blenderMain();
setContextPointer(main.C);
main.readBlend(await readFile(new URL('../../examples/meditation/meditation.blend', import.meta.url)));
const started = Date.now(), at = () => ((Date.now() - started) / 1000).toFixed(0);
let peak = 0;
setInterval(() => {
  const megabytes = blenderModule.exports.memory.buffer.byteLength / 2 ** 20;
  if (megabytes > peak) console.log(`${at()} s: memory ${(peak = megabytes)} MB`);
}, 500).unref();
let last = '';
const progress = (fraction, text) => { if (text !== last) console.log(`${at()} s: ${(last = text)}`); };
for (let run = 0; run < repeat; run++) {
  await bakeLightmaps(main, names, { resolution: 512, samples, asJob, progress });
}
console.log(`${at()} s: baked ${names.length} objects x ${repeat}, ${asJob ? 'as jobs' : 'by exec'}, ${samples} samples, ${process.env.BYLONDER_THREADS} threads`);
process.exit(0);
