// The Geometry Node Editor example's sunflowers evaluated on the IR by Bylonder's evaluator, each node through
// Blender's kernels, with no scene.blend: their meshes and instances are the app's for several inputs.
import { blenderModule } from '../src/bmesh/bmesh-wasm.js';
import { compareExample } from './geometry-nodes/compare.js';

if (!blenderModule.exports.gn_eval) {
  console.log('Geometry Node Editor on the IR: skipped, this module has no Geometry Nodes kernels yet (geometry-nodes-api.cc)');
} else {
  const { objects, milliseconds } = await compareExample('geometry-node-editor', [{}, { Socket_2: 600 }, { Socket_3: 120, Socket_5: 21 }]);
  console.log(`Geometry Node Editor on the IR: ${objects.join(', ')} equal the app's for 3 input sets, with no scene.blend (${milliseconds} ms an evaluation)`);
}
