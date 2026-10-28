// The modifiers module's check (manifest `check`, run by wasm_module.py after linking): evaluates every modifier Bylonder
// offers on Blender's cube in the given module and prints a digest of each result, or the error it reports. The build
// runs it on the module and on copies linked with their data moved, which must print the same.
// usage: node tools/blender-port/check-modifiers.mjs MODULE.wasm
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { instantiate } from '../../src/port/wasm.js';
import { createEvaluator } from '../../src/io_scene_babylon/polyfill/evaluate.js';
import { primitive_add } from '../../src/editors/mesh/editmesh-add.js';
import { blenderModifierDefinitions } from '../../src/modifiers/blender.js';

const { exports } = await instantiate(pathToFileURL(resolve(process.argv[2])));
const evaluate = createEvaluator(exports);
const cube = primitive_add('mesh.primitive_cube_add');
const base = {
  vert_positions: Float32Array.from(cube.vert_positions), edges: Int32Array.from(cube.edges), face_offsets: Int32Array.from(cube.face_offsets),
  corner_verts: Int32Array.from(cube.corner_verts), corner_edges: Int32Array.from(cube.corner_edges),
};
for (const definition of blenderModifierDefinitions) {
  const values = definition.defaults();
  let result;
  try {
    const buffers = evaluate(base, [{ type: definition.mesh.type, layouts: definition.mesh.layouts(values), values }]);
    const hash = createHash('sha1');
    for (const array of Object.values(buffers)) hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    result = `${buffers.positions.length / 3} ${hash.digest('hex').slice(0, 12)}`;
  } catch (error) {
    // A trap is the module failing, not a modifier reporting an error.
    if (error instanceof WebAssembly.RuntimeError) throw error;
    result = `error: ${error.message}`;
  }
  console.log(definition.id, result);
}
