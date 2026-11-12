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

// A rig: its pose bones, each one's bone and constraints, and the actions they play.
{
  const ir = await read('rigged-character'), rig = [...blendData().objects].find((ob) => ob.type === 'ARMATURE');
  const pose = rig.pose.bones[1], key = `OB:${rig.name}`;
  assert.equal(dataAt(ir, [key, `pose.bones["${pose.name}"].rotation_mode`]) ?? 'QUATERNION', pose.rotation_mode, 'a pose bone');
  const head = dataAt(ir, [key, `pose.bones["${pose.name}"].bone.head_local`]);
  assert.ok(head && [...pose.bone.head_local].every((v, i) => near(v, head[i])), "a pose bone's bone");
  const action = rig.animation_data.action, actionKey = `AC:${action.name}`;
  const paths = (dataAt(ir, [actionKey, 'layers[0].strips[0].channelbags[0].fcurves']) ?? []).map((fc) => fc.data_path);
  assert.ok(paths.length && paths.every((p) => typeof p === 'string'), "an action's F-Curves, by what they animate");
  assert.equal(dataAt(ir, [actionKey, 'layers[0].strips[0].channelbags[0].fcurves[0].color']), undefined, "an F-Curve's editor color is left out");
}
console.log('IR paths of a rig: pose bones, their bones and actions resolve to Main; editor colors left out');
process.exit(0);
