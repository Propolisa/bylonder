// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Worker side of a crowd split over threads (Node worker_threads or a Web Worker): it compiles the rig, owns a slice
// of the characters, and per frame reads their pose inputs, evaluates and writes their pose matrices back.
// Shared memory (cross-origin isolated pages, Node): { init: { description, first, count, inputs, outputs } }, then
// 'frame'. Without it (no COOP/COEP headers): { init: { description, first: 0, count } }, then per frame
// { inputs, outputs } as transferred ArrayBuffers for this slice, answered with the same two buffers transferred back.
import { compileRig } from './program.js';

export function crowdWorker(post, onMessage) {
  let state = null;
  onMessage((msg) => {
    if (msg.init) {
      const { description, first, count, inputs, outputs } = msg.init;
      const program = compileRig(description);
      const nB = program.bones.length;
      state = {
        program, first, count, nB, insts: Array.from({ length: count }, () => program.instance()),
        inputs: inputs && new Float64Array(inputs), outputs: outputs && new Float64Array(outputs),
      };
      post('ready');
      return;
    }
    const transfer = msg !== 'frame';
    const inputs = transfer ? new Float64Array(msg.inputs) : state.inputs, outputs = transfer ? new Float64Array(msg.outputs) : state.outputs;
    const { insts, nB } = state, first = transfer ? 0 : state.first, stride = nB * 7;
    for (let n = 0; n < insts.length; n++) {
      const inst = insts[n], o = (first + n) * stride;
      for (let b = 0; b < nB; b++) {
        const i = o + b * 7;
        inst.location[b * 3] = inputs[i]; inst.location[b * 3 + 1] = inputs[i + 1]; inst.location[b * 3 + 2] = inputs[i + 2];
        inst.rotation[b * 4] = inputs[i + 3]; inst.rotation[b * 4 + 1] = inputs[i + 4]; inst.rotation[b * 4 + 2] = inputs[i + 5]; inst.rotation[b * 4 + 3] = inputs[i + 6];
      }
      inst.touchAll();
      inst.evaluate();
      outputs.set(inst.pose, (first + n) * nB * 16);
    }
    if (transfer) post({ inputs: inputs.buffer, outputs: outputs.buffer }, [inputs.buffer, outputs.buffer]);
    else post('done');
  });
}
