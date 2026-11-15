// Evaluation of .blend files by Blender's depsgraph in the module, on the threads BYLONDER_THREADS gives it (one when
// unset): the first evaluation after opening, and again with every object's geometry tagged (median of runs).
// usage: BYLONDER_THREADS=n node bench/threads.bench.js FILE.blend... [--runs n]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';

const ID_OB = 0x424f, ID_RECALC_GEOMETRY = 1 << 1;
const args = process.argv.slice(2), at = args.indexOf('--runs');
const runs = at < 0 ? 3 : Number(args[at + 1]);
const files = args.filter((a, i) => a !== '--runs' && args[i - 1] !== '--runs');
const main = blenderMain(), { exports: x } = blenderModule;
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
for (const file of files) {
  main.readBlend(readFileSync(file));
  const first = time(() => main.evaluate());
  const again = Array.from({ length: runs }, () => time(() => { for (const ob of main.ids(ID_OB)) main.tag(ob, ID_RECALC_GEOMETRY); main.evaluate(); })).sort((a, b) => a - b)[runs >> 1];
  console.log(`${basename(file)}: first ${first.toFixed(0)} ms, again ${again.toFixed(0)} ms, ${process.env.BYLONDER_THREADS ?? 1} threads, longest page wait ${((x.threads_longest_wait?.() ?? 0) / 1e6).toFixed(1)} ms`);
}
process.exit(0);
