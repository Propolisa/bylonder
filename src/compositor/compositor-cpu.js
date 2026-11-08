// Blender's compositor on its CPU path, in the module (tools/blender-port/wasm/compositor-api.cc): the scene's
// compositing node group evaluated by Blender's own operations on a render, every node as Blender runs it. Final
// renders composite with it, in a worker (compositor-worker.js), and it is the reference the GPU compositor's tests
// compare with.
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { BMESH_WASM } from '../bmesh/bmesh-module.js';
import { compile } from '../port/wasm.js';
import { halfFloats } from '../blenkernel/colorband.js';

const { exports: x, withArrays } = blenderModule;

// The composite of `render` (width by height RGBA floats, scene linear, bottom row first) by the scene's compositing
// node group in Main, as the same; null when it has none or it outputs nothing.
export function compositeOnCPU(blender, render, width, height) {
  return withArrays([render], ([pointer]) => {
    const result = x.compositor_evaluate(blender.bmain, blender.scene, pointer, width, height);
    return result ? new Float32Array(x.memory.buffer, result >>> 0, width * height * 4).slice() : null;
  });
}

// The same, by a .blend's scene, in a worker with a module of its own, so the page stays responsive.
let worker = null, requests = 0;
const replies = new Map();
export async function compositeInWorker(blend, render, width, height) {
  if (!worker) {
    worker = new Worker(new URL('./compositor-worker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ module: await compile(BMESH_WASM) });
    worker.onmessage = ({ data }) => { replies.get(data.id)(data); replies.delete(data.id); };
  }
  const id = ++requests;
  const { result, error } = await new Promise((resolve) => {
    replies.set(id, resolve);
    worker.postMessage({ id, blend, render, width, height }, [blend.buffer, render.buffer]);
  });
  if (error) throw Error(error);
  return result;
}

// A final frame composited as Blender's render pipeline does: the render as the view transform would take it is read,
// composited, written back and displayed. Resolves to whether it composited.
export async function compositeFinalFrame(world, camera) {
  const display = world.renderSettings.display(camera), target = display?.input;
  if (!target || !world.mainSync) return false;
  const engine = world.scene.getEngine(), { texture, width, height } = target;
  const render = await engine._readTexturePixels(texture, width, height);
  const composite = await compositeInWorker(world.mainSync.writeBlend('/compositor.blend'), render, width, height);
  if (!composite) return false;
  // In place, at the target's own size (an upload of a whole texture would make it a power of two).
  engine.updateTextureData(texture, halfFloats(composite), 0, 0, width, height);
  world.scene.postProcessManager.directRender(display.passes, null, true);
  return true;
}
