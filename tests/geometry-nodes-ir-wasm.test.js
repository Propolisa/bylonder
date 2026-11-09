// The Geometry Nodes example's planet (terrain, sea, trees, clouds) evaluated on the IR by Bylonder's evaluator, each
// node through Blender's kernels, with no scene.blend: its mesh and its trees are the app's for several inputs.
import { blenderModule } from '../src/bmesh/bmesh-wasm.js';
import { compareExample } from './geometry-nodes/compare.js';

if (!blenderModule.exports.gn_eval) {
  console.log('Geometry Nodes on the IR: skipped, this module has no Geometry Nodes kernels yet (geometry-nodes-api.cc)');
} else {
  const { objects, milliseconds } = await compareExample('geometry-nodes', [{}, { Socket_2: 7 }, { Socket_3: 0.4 }, { Socket_2: 31, Socket_5: 2000 }]);
  console.log(`Geometry Nodes on the IR: ${objects.join(', ')} equal the app's for 4 input sets, with no scene.blend (${milliseconds} ms an evaluation)`);
}
