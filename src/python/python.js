// CPython in Blender's module (tools/blender-port/wasm/python.cc): Blender's own bpy, started on first use, never at
// startup. Its files go into the module's file system first: python313.zip (CPython's library and numpy, which
// zipimport reads in place) at Blender's system Python directory, and Blender's scripts (scripts.zip) and core add-ons
// (addons.zip) at its system scripts directory (ghost-paths.cc), as an installed Blender has them. What starts it: Run Script, a Python Console shown, a Python driver
// (python_requested), a file whose scripts may run, and Preferences' add-on and extension sections (startPython).
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { files, provided, read } from '../port/wasm.js';
import { contextPointer } from './bpy_rna.js';
import { unzip } from './unzip.js';
import { report } from '../windowmanager/wm-reports.js';
import { keyconfigUpdated } from '../windowmanager/wm-window.js';

const LIBRARY = new URL('../bmesh/python313.zip', import.meta.url);
const SCRIPTS = new URL('../bmesh/scripts.zip', import.meta.url);
const ADDONS = new URL('../bmesh/addons.zip', import.meta.url);
const { exports: x } = blenderModule;

let starting = null;
const started = new Set();
// fn() once Python has started (drivers evaluated again, editors redrawn).
export const whenPythonStarts = (fn) => started.add(fn);
export const pythonRunning = () => !!x.python_running();
// After Python ran (a script, a console line, an add-on enabled): the key maps it added reach the page's keymaps too.
export const pythonRan = () => keyconfigUpdated(contextPointer());

export function startPython() {
  return (starting ??= (async () => {
    report('INFO', 'Python is starting');
    const [library, ...scripts] = await Promise.all([read(LIBRARY), read(SCRIPTS), read(ADDONS)]);
    files.set('/blender/python/lib/python313.zip', new Uint8Array(library));
    for (const zip of scripts) for (const [name, data] of await unzip(zip)) files.set(`/blender/scripts/${name}`, data);
    // One step per task: the page draws and takes input between them.
    for (let step = 0; ;) {
      const at = performance.now();
      const next = x.python_start_step(contextPointer(), step);
      // Each step's time, for the performance panel.
      performance.measure('bl:python-start-step', { start: at, detail: step });
      if (next < 0) throw Error('Python did not start: see the system console');
      if (!next) break;
      step = next;
      await new Promise((resolve) => setTimeout(resolve));
    }
    report('INFO', 'Python started');
    pythonRan();
    for (const fn of started) fn();
  })());
}

provided.python_requested = () => { startPython(); };
