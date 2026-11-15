// F12 with Cycles: Blender's own render operator (render.render) in the module, with Cycles loaded on first use
// (render/cycles.js), its result read through the scene's view transform (wasm/render-api.cc) as Blender's render
// window shows it.
import { blenderModule } from '../../bmesh/bmesh-wasm.js';
import { loadCycles } from '../../render/cycles.js';
import { pointerStruct, structFind } from '../../python/bpy_rna.js';

const { exports: x } = blenderModule;

// The result as an ImageBitmap: Blender's rows start at the bottom.
function resultImage(scene) {
  const size = x.malloc(8) >>> 0;
  try {
    if (!x.render_result_size(scene, size)) throw Error('Cycles made no render result');
    const [width, height] = new Int32Array(x.memory.buffer, size >>> 0, 2);
    const pixels = x.malloc(width * height * 4) >>> 0;
    try {
      x.render_result_pixels(scene, pixels);
      const rows = new Uint8ClampedArray(x.memory.buffer, pixels >>> 0, width * height * 4), flipped = new Uint8ClampedArray(rows.length);
      for (let y = 0; y < height; y++) flipped.set(rows.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
      return createImageBitmap(new ImageData(flipped, width, height));
    } finally {
      x.free(pixels);
    }
  } finally {
    x.free(size);
  }
}

const OPERATOR_RUNNING_MODAL = 1 << 0, OPERATOR_FINISHED = 1 << 2;

// A frame source (editors/render/host.js) for the scene in `world`, rendered by Cycles in Blender's render job (F12's
// invoke), on a thread of its own while the page goes on; Cancel stops the job.
export async function cyclesSource(world) {
  await loadCycles();
  const blender = world.mainSync.blender, scene = () => blender.scene;
  let job = null;
  return {
    label: 'Cycles',
    async renderFrame(frame, progress) {
      pointerStruct(structFind('Scene'), scene(), scene()).render.engine = 'CYCLES';
      job = blender.invoke('render.render', {}, { type: 'F12' });
      if (!(job.status & (OPERATOR_RUNNING_MODAL | OPERATOR_FINISHED))) throw Error(job.report || 'Cycles did not render');
      while (x.render_job_running(blender.C, scene())) {
        progress?.(0, 1, `Rendering ${Math.round(x.render_job_progress(blender.C, scene()) * 100)}%`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      // The job's end ends the operator (screen_render_modal).
      if (job.op) blender.modal(job.op, { type: 'TIMER' });
      job = null;
      return resultImage(scene());
    },
    dispose() {
      if (!job) return;
      x.render_job_stop(blender.C, scene());
      if (job.op) blender.modal(job.op, { type: 'TIMER' });
    },
  };
}
