// The IR writes the floats Blender's RNA gives (C floats) at their shortest text that reads back as the same float32
// (ir-export.js float32): each value reads back bit-equal to Blender's, with no float64 digits left over.
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { float32 } from '../src/io_scene_babylon/ir-export.js';
import { openExample } from './open-example.js';

// Random float32 values, of every magnitude, read back as themselves from fewer digits.
const bits = new Uint32Array(1), as = new Float32Array(bits.buffer);
for (let i = 0; i < 20000; i++) {
  bits[0] = (Math.random() * 2 ** 32) >>> 0;
  const v = as[0];
  if (!Number.isFinite(v)) continue;
  const short = float32(v);
  assert.equal(Math.fround(short), v, `${v} reads back as itself`);
  assert.ok(short.toExponential().split('e')[0].replace(/[-.]/g, '').length <= 9, `${v}: at most 9 significant digits (${short})`);
}
assert.equal(float32(0.1 + 0.2), 0.1 + 0.2, 'a value that is no float32 stays as it is');

const { world, sync } = openExample('rigged-character');
sync.view();
const ir = JSON.parse((await exportModule(world))['scene.ir.json']);
let checked = 0;
for (const ob of blendData().objects) for (const name of ['location', 'rotation_euler', 'scale']) {
  const exported = ir.ids[`OB:${ob.name}`]?.data?.[name];
  if (!exported) continue;
  [...ob[name]].forEach((v, i) => assert.equal(Math.fround(exported[i]), v, `${ob.name}.${name}[${i}] reads back as Blender's float`));
  checked++;
}
assert.ok(checked > 3, `objects' transforms checked (${checked})`);
const location = ir.properties['objects["Key"].location[0]'];
assert.equal(Math.fround(location.default), blendData().objects.get('Key').location[0], "a FLOAT control's default reads back as Blender's float");
const long = JSON.stringify(ir.ids).match(/-?\d+\.\d{10,}/g) ?? [];
assert.ok(long.every((text) => Math.fround(+text) !== +text), `no float32 value spelled with float64's digits: ${long.filter((t) => Math.fround(+t) === +t).slice(0, 3)}`);
console.log('IR float32: Blender\'s floats written at their shortest exact text');
process.exit(0);
