// A patch of a page whose rig runs on the native runtime (BlendScene.patch, pose-constraints.js detach): the rig's
// entity made again replaces its pose (no second solve left posing with the old inputs), and a skeleton made again is
// posed and its meshes deformed (no solve left posing the old one). Each patched page poses and deforms as a new export of the same scene does.
import assert from 'node:assert/strict';
import { NullEngine, VertexBuffer } from '@babylonjs/core';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
// An Action constraint, which Blender's constraint kernels do not run, puts the rig on the native runtime.
const action = Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false });
action.action = rig.animation_data.action;
// A copy of the body, its Corrective Smooth only the runtime runs.
const smooth = data.objects.new('Smooth', body.data.copy());
C.scene.collection.objects.link(smooth);
Object.assign(smooth, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
smooth.modifiers.new('Armature', 'ARMATURE').object = rig;
Object.assign(smooth.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'), { factor: 0.8, iterations: 4, use_only_smooth: true });
const tag = () => { sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2); sync.view(); };
tag();

const exported = async () => { const made = await exportPackage(world); return { made, state: packageState(made) }; };
const loaded = async ({ made }) => {
  const written = writePackage(made.files), blend = await (await import(written.url)).load(new NullEngine());
  await blend.settled();
  blend.playhead.pause();
  return { blend, remove: written.remove };
};
const frame = (blend) => blend.controls().find((c) => c.path.endsWith('.frame_current')).path;
// The bones' local matrices and the meshes' drawn positions at a frame.
const shown = async (blend, f) => {
  blend.set(frame(blend), f);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  const skeleton = blend.scene.skeletons[0];
  return { bones: skeleton.bones.map((b) => b.getLocalMatrix().asArray()), meshes: Object.fromEntries(['Body', 'Smooth'].map((n) => [n, Array.from(blend.scene.getMeshByName(n).getVerticesData(VertexBuffer.PositionKind))])) };
};
const farthest = (a, b) => a.reduce((worst, x, i) => Math.max(worst, Math.abs(x - b[i])), 0);
const same = async (page, fresh, what) => {
  for (const f of [1, 11]) {
    const ours = await shown(page, f), theirs = await shown(fresh, f);
    assert.ok(ours.bones.every((m, i) => farthest(m, theirs.bones[i]) < 1e-5), `${what}: the bones at frame ${f} as the new export poses them`);
    for (const name of ['Body', 'Smooth']) {
      const d = farthest(ours.meshes[name], theirs.meshes[name]);
      assert.ok(d < 1e-4, `${what}: ${name} at frame ${f} as the new export draws it (${(d * 1000).toFixed(3)} mm)`);
    }
  }
};

const first = await exported();
assert.ok(Object.keys(Object.values(JSON.parse(first.made.files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE')?.inputs.native?.meshes ?? {}).includes('Smooth'),
  'the copy deforms on the runtime');
const page = await loaded(first);
await shown(page.blend, 11);

// The Action constraint's evaluation time changed: the rig's entity is made again.
action.eval_time = 0.9;
tag();
const second = await exported(), patch = tablesPatch(first.state, second.state);
assert.ok(Object.keys(patch.tables.entities ?? {}).some((key) => key === 'OB:Rig/constraints/pose'), `the patch replaces the rig's entity: ${Object.keys(patch.tables.entities ?? {})}`);
assert.equal(await page.blend.patch({ ...patch, buffers: second.made.buffers }), page.blend, 'and applies to the open page');
const fresh = await loaded(second);
await same(page.blend, fresh.blend, 'a rig made again');
fresh.blend.dispose();
fresh.remove();

// A bone's rest moved in edit mode: the skeleton is made again (the scheduler attaches the rig's pose to the new one),
// and the rig's entity with it.
C.view_layer.objects.active = rig;
sync.blender.run('object.mode_set', { mode: 'EDIT' });
const hand = rig.data.edit_bones.get('hand.L') ?? [...rig.data.edit_bones].find((b) => b.name.startsWith('hand'));
hand.tail = [hand.tail[0], hand.tail[1], hand.tail[2] + 0.02];
sync.blender.run('object.mode_set', { mode: 'OBJECT' });
tag();
const third = await exported(), reshaped = tablesPatch(second.state, third.state);
assert.ok(reshaped.tables.skeletons, `the patch makes the skeleton again: ${Object.keys(reshaped.tables)}`);
assert.equal(await page.blend.patch({ ...reshaped, buffers: third.made.buffers }), page.blend, 'and applies to the open page');
// The meshes the patch keeps skin with the skeleton made again, not the one it replaced.
const skinned = page.blend.scene.meshes.filter((mesh) => mesh.skeleton);
assert.ok(skinned.length && skinned.every((mesh) => page.blend.scene.skeletons.includes(mesh.skeleton)), `the kept meshes take the new skeleton: ${skinned.map((m) => m.name)}`);
const refreshed = await loaded(third);
await same(page.blend, refreshed.blend, 'a skeleton made again');
refreshed.blend.dispose();
refreshed.remove();
page.blend.dispose();
page.remove();
console.log('Export patch native rig: a patched rig poses and deforms as a new export, its old pose and deformers let go');
process.exit(0);
