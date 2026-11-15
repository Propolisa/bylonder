import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { setContextPointer } from '../src/python/bpy_rna.js';
import { startPython } from '../src/python/python.js';
import { loadCycles } from '../src/render/cycles.js';
import { files } from '../src/port/wasm.js';

const { exports: x } = blenderModule;
const main = blenderMain();
setContextPointer(main.C);
const count = (s) => [...files.keys()].filter((k) => k.includes(s)).length;
console.log('before', files.size);
await startPython();
console.log('python', files.size, count('addons_core'));
await loadCycles();
console.log('cycles', files.size, count('addons_core'), count('cycles'));
const py = (code) => blenderModule.withString(code, (p) => { const g = x.PyGILState_Ensure(); x.PyRun_SimpleStringFlags(p, 0); x.PyGILState_Release(g); });
py(`import sys, traceback
out = []
try:
    import bpy, addon_utils
    out.append(repr(('_cycles' in sys.modules, addon_utils.paths())))
    out.append(repr(bpy.context.preferences.addons.keys()))
    import importlib; importlib.invalidate_caches(); import cycles
    out.append(repr([getattr(e, 'bl_idname', e.__name__) for e in bpy.types.RenderEngine.__subclasses__()]))
    addon_utils.enable('cycles', default_set=True, handle_error=lambda e: out.append(traceback.format_exc()))
    out.append(repr(bpy.context.preferences.addons.keys()))
except Exception:
    out.append(traceback.format_exc())
with open('/tmp/debug.txt', 'w') as f: f.write(chr(10).join(out))
`);
console.log(new TextDecoder().decode(files.get('/tmp/debug.txt')));
process.exit(0);
