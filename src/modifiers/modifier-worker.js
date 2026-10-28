// A worker evaluating Blender's modifiers in its own instance of the module, which its creator compiled.
import { provideModule } from '../port/wasm.js';
import { BMESH_WASM } from '../bmesh/bmesh-module.js';

let blender;
onmessage = async ({ data }) => {
  if (data.module) {
    provideModule(BMESH_WASM, data.module);
    blender = import('./blender.js');
    return;
  }
  try {
    const result = (await blender).evaluate(data.evaluation);
    postMessage({ result }, Object.values(result.buffers).map((buffer) => buffer.buffer));
  } catch (error) {
    postMessage({ error: error.message, name: error.name });
  }
};
