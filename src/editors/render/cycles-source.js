// F12 with Cycles: Blender's own render operator (render.render) in the module, with Cycles loaded on first use
// (render/cycles.js), its result read through the scene's view transform (wasm/render-api.cc) as Blender's render
// window shows it. The render blocks the page while it runs, so the status says so first.
import { blenderModule } from '../../bmesh/bmesh-wasm.js';
import { loadCycles } from '../../render/cycles.js';

const { exports: x } = blenderModule;

// The result as an ImageBitmap: Blender's rows start at the bottom.
function resultImage(scene) {
  const size = x.malloc(8) >>> 0;
  try {
    if (!x.render_result_size(scene, size)) throw Error('Cycles made no render result');
    const [width, height] = new Int32Array(x.memory.buffer, size, 2);
    const pixels = x.malloc(width * height * 4) >>> 0;
    try {
      x.render_result_pixels(scene, pixels);
      const rows = new Uint8ClampedArray(x.memory.buffer, pixels, width * height * 4), flipped = new Uint8ClampedArray(rows.length);
      for (let y = 0; y < height; y++) flipped.set(rows.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
      return createImageBitmap(new ImageData(flipped, width, height));
    } finally {
      x.free(pixels);
    }
  } finally {
    x.free(size);
  }
}

// A frame source (editors/render/host.js) for the scene in `world`, rendered by Cycles.
export async function cyclesSource(world) {
  await loadCycles();
  const blender = world.mainSync.blender;
  return {
    label: 'Cycles',
    async renderFrame(frame, progress) {
      progress?.(0, 1, 'Rendering');
      // A frame for the status to show before the render holds the page.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
      const { status, report } = blender.run('render.render', {});
      // OPERATOR_FINISHED
      if (!(status & 1)) throw Error(report || 'Cycles did not render');
      return resultImage(blender.scene);
    },
    dispose() {},
  };
}
