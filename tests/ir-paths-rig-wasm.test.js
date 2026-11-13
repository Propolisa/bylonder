// What a page's SDK reads of a package's IR by RNA path (runtime/ir.js dataAt) after File > Export > JavaScript leaves
// out what no page reads: a shape key's per-vertex points (bulk data, as a mesh's vertices are) and the editors' channel
// and bone colors. A rig's pose bones, their bones, constraints and actions, and a shape key's settings still resolve
// to Main's values.
import assert from 'node:assert/strict';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { dataAt } from '../src/io_scene_babylon/runtime/ir.js';
import { openExample } from './open-example.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;
const { world, sync } = openExample('rigged-character');
const read = async () => {
  sync.view();
  return JSON.parse((await exportModule(world, { animations: 'CLIPS' }))['scene.ir.json']);
};

// A rig: its pose bones, each one's bone and constraints, and the actions they play.
{
  const ir = await read(), rig = [...blendData().objects].find((ob) => ob.type === 'ARMATURE');
  const pose = rig.pose.bones[1], key = `OB:${rig.name}`;
  assert.equal(dataAt(ir, [key, `pose.bones["${pose.name}"].rotation_mode`]) ?? 'QUATERNION', pose.rotation_mode, 'a pose bone');
  const head = dataAt(ir, [key, `pose.bones["${pose.name}"].bone.head_local`]);
  assert.ok(head && [...pose.bone.head_local].every((v, i) => near(v, head[i])), "a pose bone's bone");
  const action = rig.animation_data.action, actionKey = `AC:${action.name}`;
  const paths = (dataAt(ir, [actionKey, 'layers[0].strips[0].channelbags[0].fcurves']) ?? []).map((fc) => fc.data_path);
  assert.ok(paths.length && paths.every((p) => typeof p === 'string'), "an action's F-Curves, by what they animate");
  assert.equal(dataAt(ir, [actionKey, 'layers[0].strips[0].channelbags[0].fcurves[0].color']), undefined, "an F-Curve's editor color is left out");
}
// A bone whose B-Bone end handle is the tip of a chain of bones: the IR meets the chain first through the handle, its
// parents past the depth it writes structs to, and names each by where it is written in full instead of losing it
// (a Rigify rig's DEF bone reaching the head's ROOT bone this way).
{
  const rig = [...blendData().objects].find((ob) => ob.type === 'ARMATURE'), C = contextStruct();
  C.view_layer.objects.active = rig;
  sync.blender.run('object.mode_set', { mode: 'EDIT' });
  const lead = Object.assign(rig.data.edit_bones.new('Lead'), { head: [1, 0, 0], tail: [1, 0.05, 0] });
  const chain = Array.from({ length: 8 }, (_, i) => Object.assign(rig.data.edit_bones.new(`Chain-${i}`), { head: [0, 0, (i + 1) * 0.1], tail: [0, 0.05, (i + 1) * 0.1] }));
  chain.forEach((bone, i) => { if (i) bone.parent = chain[i - 1]; });
  Object.assign(lead, { bbone_segments: 2, bbone_handle_type_end: 'ABSOLUTE', bbone_custom_handle_end: chain.at(-1) });
  sync.blender.run('object.mode_set', { mode: 'OBJECT' });
  const ir = await read(), key = `OB:${rig.name}`;
  for (let i = 0; i < chain.length; i++) {
    const at = (path) => dataAt(ir, [key, path])?.[2];
    assert.ok(near(at(`pose.bones["Chain-${i}"].bone.head_local`) ?? NaN, (i + 1) * 0.1), `Chain-${i}'s bone`);
    assert.ok(near(at(`pose.bones["Lead"].bone.bbone_custom_handle_end${'.parent'.repeat(chain.length - 1 - i)}.head_local`) ?? NaN, (i + 1) * 0.1), `Chain-${i}'s bone through the handle`);
  }
}
console.log('IR paths of a rig: pose bones, their bones and actions resolve to Main; editor colors left out');
process.exit(0);
