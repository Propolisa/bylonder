// Blender's compositor on its CPU path off the page's thread (compositor-cpu.js compositeInWorker): a module of its
// own, given the page's compiled one, reads the scene's .blend and composites the render with it.
import { provideModule } from '../port/wasm.js';
import { BMESH_WASM } from '../bmesh/bmesh-module.js';

let modules = null;
onmessage = async ({ data }) => {
  if (data.module) {
    provideModule(BMESH_WASM, data.module);
    modules = Promise.all([import('../bmesh/bmesh-wasm.js'), import('./compositor-cpu.js')]);
    return;
  }
  try {
    const [{ blenderMain }, { compositeOnCPU }] = await modules, blender = blenderMain();
    blender.readBlend(data.blend);
    const result = compositeOnCPU(blender, data.render, data.width, data.height);
    postMessage({ id: data.id, result }, result ? [result.buffer] : []);
  } catch (error) {
    postMessage({ id: data.id, error: error.message });
  }
};
