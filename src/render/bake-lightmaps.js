// Bake Lightmaps (Render properties > Bake > Lightmaps, docs/features/lightmaps.md): the selected objects' light baked
// by Cycles into their Bylonder lightmaps (object.bylonder.lightmap), each bake Blender's own (object.bake) run as its
// job, on a thread of its own while the page goes on, then denoised by Open Image Denoise on WebGPU (render/denoise.js).
// What each bake is and how its light is stored is bylonder_lightmaps.py's, which desktop Blender scripts share
// (examples/meditation/meditation.py); it runs in the module's Python, its arrays passed through the module's files.
import { __class__, __kwargtrans__, set } from '../bl_py/org.transcrypt.__runtime__.js';
import { blenderModule, OPERATOR_FINISHED, OPERATOR_RUNNING_MODAL, operatorEnded } from '../bmesh/bmesh-wasm.js';
import { files, read } from '../port/wasm.js';
import { registerClass } from '../python/bpy_rna.js';
import { registerSettings } from '../runtimes/runtimes.js';
import { tick } from '../windowmanager/wm-areas.js';
import { startJob } from '../windowmanager/wm-jobs.js';
import { report } from '../windowmanager/wm-reports.js';
import { loadCycles, whenCyclesLoads } from './cycles.js';
import { denoise } from './denoise.js';

const { exports: x } = blenderModule;
const kw = (keywords) => __kwargtrans__(keywords);
const SCRIPT = new URL('./bylonder_lightmaps.py', import.meta.url);
const MODULE = '/blender/scripts/modules/bylonder_lightmaps.py', CALL = '/bylonder-lightmaps-call.py', RESULT = '/bylonder-lightmaps.json';
const PIXELS = '/bylonder-lightmaps.f32';
const text = new TextEncoder(), untext = new TextDecoder();

registerSettings('Scene', {
  settings(props, types) {
    const Group = __class__('BYLONDER_PG_lightmap_bake', [types.PropertyGroup], {
      __annotations__: {
        resolution: props.IntProperty(kw({ name: 'Resolution', description: 'The width and height of a new lightmap, in pixels: an object with a lightmap image bakes at its size', default: 1024, min: 16, soft_max: 4096, subtype: 'PIXEL', options: new Set() })),
        samples: props.IntProperty(kw({ name: 'Samples', description: 'Cycles samples per pixel of each bake, before the light is denoised', default: 128, min: 1, soft_max: 4096, options: new Set() })),
      },
    });
    registerClass(Group);
    return { lightmap_bake: props.PointerProperty(kw({ type: Group, name: 'Lightmap Bake', description: 'How Bake Lightmaps bakes' })) };
  },
});

// bylonder_lightmaps.py in the module's Python, once.
let installed = null;
const install = () => (installed ??= read(SCRIPT).then((bytes) => files.set(MODULE, new Uint8Array(bytes))));

// A call of bylonder_lightmaps (`call`, a Python expression on it) in the module's Python: its JSON result.
function python(blender, call) {
  files.set(CALL, text.encode(`import importlib, json, traceback
importlib.invalidate_caches()
try:
    import bylonder_lightmaps as lightmaps
    result = {'value': lightmaps.${call}}
except Exception:
    result = {'error': traceback.format_exc()}
open(${JSON.stringify(RESULT)}, 'w').write(json.dumps(result))
`));
  blender.run('script.python_file_run', { filepath: CALL });
  const answer = files.get(RESULT);
  files.delete(CALL);
  files.delete(RESULT);
  const { value, error } = answer ? JSON.parse(untext.decode(answer)) : { error: 'Python did not run' };
  if (error) throw Error(error);
  return value;
}
const literal = (value) => JSON.stringify(value);

class Cancelled extends Error {}

// Blender's bake of the object as its job (object.bake's invoke); `progress(fraction)` as it goes. Cancel is Esc, as in
// Blender (bake_modal). Resolves once the job ended.
async function bakeJob(blender, args, progress, cancelled) {
  // The window's interface is locked while the job's thread bakes, as Blender's Lock Interface does for renders
  // (docs/blender-boundary.md, Jobs).
  x.wm_interface_lock(blender.C, true);
  try {
    await runJob(blender, args, progress, cancelled);
  } finally {
    x.wm_interface_lock(blender.C, false);
  }
  if (cancelled()) throw new Cancelled();
}

async function runJob(blender, args, progress, cancelled) {
  const job = blender.invoke('object.bake', args, { type: 'LEFTMOUSE' });
  if (!(job.status & (OPERATOR_RUNNING_MODAL | OPERATOR_FINISHED))) throw Error(job.report || 'Cycles did not bake');
  let stopping = false;
  while (job.op) {
    tick();
    if (cancelled() && !stopping) {
      blender.modal(job.op, { type: 'ESC' });
      stopping = true;
    }
    if (operatorEnded(blender.modal(job.op, { type: 'TIMER' }))) break;
    progress(x.render_job_progress(blender.C, blender.scene));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // The window frees the ended job (wm_jobs_handle_finished), so the next bake may start.
  tick();
}

// The light, albedo and normals the module's Python wrote, as RGB float planes.
function planes(size) {
  const floats = new Float32Array(files.get(PIXELS).slice().buffer), count = size * size * 3;
  return [0, 1, 2].map((i) => floats.subarray(i * count, (i + 1) * count));
}

/**
 * Bakes the lightmaps of the named objects (`names`) in Blender's module (`blender`, a BlenderMain), each by its
 * setting's Direct, at its image's size or else `resolution` pixels, with `samples`; `progress(fraction, text)` as it
 * goes, `cancelled()` stops it after the bake running. Returns each object's { name, intensity, denoised }.
 */
export async function bakeLightmaps(blender, names, { resolution, samples, progress = () => {}, cancelled = () => false }) {
  await Promise.all([loadCycles(), install()]);
  const baked = [];
  for (const [index, name] of names.entries()) {
    try {
      const steps = python(blender, `start(${literal(name)}, ${resolution}, ${samples})`), parts = steps.length + 1;
      for (const [at, step] of steps.entries()) {
        const args = python(blender, `begin(${literal(step)})`);
        await bakeJob(blender, args, (fraction) => progress((index + (at + fraction) / parts) / names.length, `${name} ${step}`), cancelled);
        python(blender, `end(${literal(step)})`);
      }
      progress((index + steps.length / parts) / names.length, `${name} denoising`);
      const size = python(blender, `write_inputs(${literal(PIXELS)})`);
      const [light, albedo, normal] = planes(size), denoised = await denoise(light, albedo, normal, size);
      files.set(PIXELS, new Uint8Array((denoised ?? light).slice().buffer));
      baked.push({ name, intensity: python(blender, `store_from(${literal(PIXELS)})`), denoised: !!denoised });
    } catch (error) {
      python(blender, 'cancel()');
      if (error instanceof Cancelled) break;
      throw error;
    } finally {
      files.delete(PIXELS);
    }
  }
  return baked;
}

const BAKING = 'Bake Lightmaps';
let baking = false;

/**
 * Registers Bake Lightmaps (bylonder.bake_lightmaps) and, once Cycles is loaded, its panel in Render properties > Bake.
 * `blender()` gives the scene's BlenderMain; `changed()` follows a bake (the view, an undo step, the UI).
 */
export function registerBakeLightmaps({ icon, blender, changed }) {
  const types = () => globalThis.__py_modules['_bpy.types'];
  registerClass(__class__('BYLONDER_OT_bake_lightmaps', [types().Operator], {
    bl_idname: 'bylonder.bake_lightmaps', bl_label: 'Bake Lightmaps',
    bl_description: "Bake the selected meshes' light with Cycles into their lightmaps (Object properties > Lightmap), denoised, each by its Direct",
    poll: (C) => !baking && C.mode === 'OBJECT' && [...C.selected_objects].some((ob) => ob.type === 'MESH'),
    execute(C) {
      const names = [...C.selected_objects].filter((ob) => ob.type === 'MESH').map((ob) => ob.name);
      const { resolution, samples } = C.scene.bylonder.lightmap_bake;
      let cancel = false;
      const job = startJob(BAKING, () => { cancel = true; });
      baking = true;
      const started = performance.now();
      bakeLightmaps(blender(), names, { resolution, samples, cancelled: () => cancel, progress: (fraction, text) => Object.assign(job, { progress: fraction, text }) })
        .then((baked) => {
          const seconds = ((performance.now() - started) / 1000).toFixed(0);
          report('INFO', `Baked ${baked.length} lightmap${baked.length === 1 ? '' : 's'} in ${seconds} s${cancel ? ', then cancelled' : ''}`);
          if (baked.some((b) => !b.denoised)) report('WARNING', 'Lightmaps not denoised: Open Image Denoise needs WebGPU');
        })
        .catch((error) => report('ERROR', `Bake Lightmaps: ${error.message}`))
        .finally(() => { baking = false; job.end(); changed(); });
      return set(['FINISHED']);
    },
  }));
  whenCyclesLoads(() => registerClass(__class__('CYCLES_RENDER_PT_bake_bylonder_lightmaps', [types().Panel], {
    bl_label: 'Lightmaps', bl_space_type: 'PROPERTIES', bl_region_type: 'WINDOW', bl_context: 'render', bl_parent_id: 'CYCLES_RENDER_PT_bake',
    draw_header() { this.layout.label(kw({ text: '', icon_value: icon })); },
    draw(C) {
      const { layout } = this, settings = C.scene.bylonder.lightmap_bake;
      layout.use_property_split = true;
      layout.use_property_decorate = false;
      layout.prop(settings, 'resolution');
      layout.prop(settings, 'samples');
      layout.operator('bylonder.bake_lightmaps', kw({ icon_value: icon }));
    },
  })));
}
