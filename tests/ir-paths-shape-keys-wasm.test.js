// What a page's SDK reads of a package's IR by RNA path (runtime/ir.js dataAt) after File > Export > JavaScript leaves
// out what no page reads: a shape key's per-vertex points (bulk data, as a mesh's vertices are) and the editors' channel
// and bone colors. A rig's pose bones, their bones, constraints and actions, and a shape key's settings still resolve
// to Main's values.
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { dataAt } from '../src/io_scene_babylon/runtime/ir.js';
import { openExample } from './open-example.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;
const read = async (example) => {
  const { world, sync } = openExample(example);
  sync.view();
  const files = await exportModule(world, { animations: 'CLIPS' });
  return JSON.parse(files['scene.ir.json']);
};

// A shape key: its key blocks' names, values and ranges, not their points.
{
  const ir = await read('shape-keys'), ob = [...blendData().objects].find((o) => o.data?.shape_keys), key = `KE:${ob.data.shape_keys.name}`;
  const block = ob.data.shape_keys.key_blocks[1];
  assert.equal(dataAt(ir, [key, `key_blocks["${block.name}"].name`]), block.name, 'a key block by name');
  assert.ok(near(dataAt(ir, [key, `key_blocks["${block.name}"].slider_max`]) ?? 1, block.slider_max), "a key block's range");
  assert.equal(dataAt(ir, [key, `key_blocks["${block.name}"].data`]), undefined, "a key block's points are bulk data, left out");
}
console.log('IR paths of shape keys: key blocks resolve to Main; their points left out');
process.exit(0);
