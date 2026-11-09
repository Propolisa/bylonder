// The Geometry Node Editor example's sunflowers evaluated on the IR by Bylonder's evaluator, each node through the
// Geometry Nodes kernels a package ships, with no scene.blend: their meshes and instances are the app's for several
// inputs.
import { compareExample, shippedKernels } from './geometry-nodes/compare.js';

const kernels = await shippedKernels();
if (!kernels.gn_eval) {
  console.log('Geometry Node Editor on the IR: skipped, this module has no Geometry Nodes kernels yet (geometry-nodes-api.cc)');
} else {
  const { objects, milliseconds } = await compareExample('geometry-node-editor', [{}, { Socket_2: 600 }, { Socket_3: 120, Socket_5: 21 }], kernels);
  console.log(`Geometry Node Editor on the IR: ${objects.join(', ')} equal the app's for 3 input sets, with no scene.blend and the package's kernels (${milliseconds} ms an evaluation)`);
}
