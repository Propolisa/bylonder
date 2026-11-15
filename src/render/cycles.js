// Cycles: Blender's path tracer, built as the side module cycles.wasm with its add-on (cycles.zip) beside Blender's
// module, fetched and linked into it (port/side-modules.js) the first time something renders with Cycles; nothing is
// downloaded before. wasm/cycles-api.cc starts it as Blender's main() does and enables its add-on.
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { files, missing, read } from '../port/wasm.js';
import { loadSideModule } from '../port/side-modules.js';
import { startPython } from '../python/python.js';
import { unzip } from '../python/unzip.js';
import { report } from '../windowmanager/wm-reports.js';

const MODULE = new URL('../bmesh/cycles.wasm', import.meta.url);
const ADDON = new URL('../bmesh/cycles.zip', import.meta.url);

let loading = null;
export function loadCycles() {
  return (loading ??= (async () => {
    report('INFO', 'Cycles is loading');
    const [bytes, addon] = await Promise.all([read(MODULE), read(ADDON), startPython()]);
    for (const [name, data] of await unzip(addon)) files.set(`/blender/scripts/${name}`, data);
    const cycles = await loadSideModule(blenderModule.exports, bytes, missing, blenderModule.threads);
    cycles.cycles_start();
    report('INFO', 'Cycles loaded');
  })());
}
