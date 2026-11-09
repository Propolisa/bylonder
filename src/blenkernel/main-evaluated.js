// What Main evaluated, drawn into Babylon objects with nothing of the editor's: Blender's matrices as Babylon's and
// instances as thin instances. The view (main-view.js) draws through it.
import { Matrix } from '@babylonjs/core';

// Main's ID types (ID_Type, the ID code's two letters).
export const ID_OB = 0x424f, ID_GR = 0x5247, ID_MA = 0x414d, ID_WO = 0x4f57;

// Blender's matrix (column-major, Z up) as Babylon's (row-major, Y up): Babylon's (x, y, z) is Blender's (x, z, y).
const AXIS = [0, 2, 1, 3];
const swapped = (m) => Array.from({ length: 16 }, (_, i) => m[AXIS[i >> 2] * 4 + AXIS[i & 3]]);
export const babylonMatrix = (m) => Matrix.FromArray(swapped(m));
export const blenderMatrix = (matrix) => swapped(matrix.m);

// Instance groups (BlenderMain.instances) drawn as a carrier's thin instances: their world matrices copied once from the
// module's memory into a buffer that grows by doubling and is otherwise reused, the bounds over the instances drawn.
export function drawThinInstances(carrier, groups) {
  const metadata = (carrier.metadata ??= {}), length = groups.reduce((sum, group) => sum + group.data.length, 0);
  let buffer = metadata.instances;
  if (!(buffer?.length >= length)) {
    buffer = metadata.instances = new Float32Array(Math.max(16, 2 ** Math.ceil(Math.log2(length))));
    carrier.thinInstanceSetBuffer('matrix', buffer, 16, false);
  }
  groups.reduce((offset, group) => { buffer.set(group.data, offset); return offset + group.data.length; }, 0);
  carrier.thinInstanceBufferUpdated('matrix');
  carrier.thinInstanceCount = length / 16;
  metadata.instancesVersion = (metadata.instancesVersion ?? 0) + 1;
  // Not the buffer's unused zero matrices: NaN bounds cull a carrier of several materials, whose submeshes are tested
  // against them.
  carrier.thinInstanceRefreshBoundingInfo(true);
}
