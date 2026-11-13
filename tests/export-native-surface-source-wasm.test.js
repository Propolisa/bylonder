// A mesh deformed on the native rig runtime whose Surface Deform follows a mesh the page does not draw (a hidden helper,
// as Snow's teeth follow theirs): the export puts the helper in the rig's description as data, so the page deforms
// the mesh as in Blender instead of throwing on its first frame, and the export's own check runs every mesh it sends
// to the runtime with the description the page gets.
import assert from 'node:assert/strict';
import { NullEngine, VertexBuffer } from '@babylonjs/core';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { deformsOnPage } from '../src/io_scene_babylon/pose-export.js';
import { rigDescription } from '../src/io_scene_babylon/rig-description.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
const copy = (name) => {
  const ob = data.objects.new(name, body.data.copy());
  C.scene.collection.objects.link(ob);
  Object.assign(ob, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
  ob.modifiers.new('Armature', 'ARMATURE').object = rig;
  return ob;
};
// An Action constraint, which Blender's constraint kernels do not run, puts the rig on the native runtime.
Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false }).action = rig.animation_data.action;
// The helper: skinned by the rig, in a collection hidden in viewports and renders (as Snow's rig helpers are). The
// follower: a Surface Deform onto it alone, bound at rest (as Snow's lower teeth).
const helper = copy('Helper'), helpers = data.collections.new('Helpers');
C.scene.collection.children.link(helpers);
C.scene.collection.objects.unlink(helper);
helpers.objects.link(helper);
const follower = data.objects.new('Follower', body.data.copy());
C.scene.collection.objects.link(follower);
Object.assign(follower, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
follower.modifiers.new('Surface', 'SURFACE_DEFORM').target = helper;
sync.view();
C.view_layer.objects.active = follower;
sync.blender.run('object.surfacedeform_bind', { modifier: 'Surface' });
Object.assign(helpers, { hide_viewport: true, hide_render: true });
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
sync.view();
assert.ok(follower.modifiers.get('Surface').is_bound, 'the Surface Deform is bound');

const reports = [];
subscribeReports((r) => reports.push(r));
const files = await exportModule(world);
const pose = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.ok(Object.keys(pose?.inputs.native?.meshes ?? {}).includes('Follower'), `the follower deforms on the runtime (${Object.keys(pose?.inputs.native?.meshes ?? {})}; ${JSON.stringify(reports.map((r) => r.message))})`);
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path, page = blend.scene.getMeshByName('Follower');
const node = world.objects.find((n) => n.name === 'Follower');
let worst = 0;
for (const f of [1, 11]) {
  blend.set(frame, f);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  sync.frameChanged(f);
  const ours = page.getVerticesData(VertexBuffer.PositionKind), theirs = sync.blender.evaluatedMesh(sync.objectOf(node)).vert_positions;
  // Main's vertices in Blender's axes, the page's in Babylon's (y up): compared by their spread.
  const spread = (p, up) => { let lo = Infinity, hi = -Infinity; for (let i = up; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } return hi - lo; };
  worst = Math.max(worst, Math.abs(spread(ours, 1) - spread(theirs, 2)));
}
assert.ok(worst < 1e-3, `the follower moves as in Blender (${(worst * 1000).toFixed(2)} mm)`);
blend.dispose();
written.remove();

// The export's check runs each mesh it sends to the runtime on the description the page gets: the follower without its
// surface fails it, with the surface it deforms.
const meshOf = (ob) => sync.blender.mesh(sync.objectOf(world.objects.find((n) => n.name === ob.name)));
assert.throws(() => deformsOnPage(rigDescription(rig, [follower], meshOf), ['Follower']), /cannot deform Follower/);
deformsOnPage(rigDescription(rig, [follower, helper], meshOf), ['Follower']);
console.log("Export native surface source: a Surface Deform following a hidden helper deforms on the page as in Blender, and the export's check fails a mesh the page could not deform");
process.exit(0);
