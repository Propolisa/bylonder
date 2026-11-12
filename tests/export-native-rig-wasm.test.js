// The JavaScript export's bone constraints on the native rig runtime (runtime/native-solve.js, the clean room's
// babylon-blender-rig, MIT): the Rigged Character's rig given an Action constraint, which Blender's constraint kernels
// do not run, is posed in the page by the runtime from its bylonder-rig description (rig-description.js) at frames of
// its animation as Main poses it, nothing sampled; its body, given a Corrective Smooth after its Armature, which
// Babylon's skinning cannot run (its smoothing alone, which the runtime matches exactly), is deformed by the runtime in
// the page as Main evaluates it; and its skinned twin's elbow corrective, a shape key driven by the arm's angle through a
// driver the page cannot run, takes the value the runtime's drivers give it, as Main's.
import assert from 'node:assert/strict';
import { Matrix, NullEngine, VertexBuffer } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { setCustomProperty } from '../src/blenkernel/animation/anim-blender.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const FRAMES = [1, 8, 15, 21];
// The IK solver's tolerance, as a matrix's entries.
const TOLERANCE = 1e-3;
// The runtime's deform of the body, within 7.5 mm of Main's at these frames, all at the left elbow (IK with Preserve
// Volume, a case with the clean room); its multi-segment tail as Main's, its animated B-Bone curves given to the runtime.
const DEFORM_TOLERANCE = 8e-3;

const { world, sync } = openExample('rigged-character');
const rig = blendData().objects.get('Rig');
// The rig's own action, played on the spine by the chest's Action constraint at a fixed time.
const action = Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false });
action.action = rig.animation_data.action;
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
const body = blendData().objects.get('Body'), bodyNode = world.objects.find((n) => n.name === 'Body');
// A twin the skeleton skins, as the rig's skeleton lives on its skinned meshes.
const C = contextStruct(), twin = C.blend_data.objects.new('Twin', body.data);
C.scene.collection.objects.link(twin);
Object.assign(twin, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
twin.modifiers.new('Armature', 'ARMATURE').object = rig;
// The elbow corrective's and the Breathe key's drivers given an identity Generator, which the page's driver units do not
// run: the runtime does.
for (const name of ['Elbow.L', 'Breathe']) [...body.data.shape_keys.animation_data.drivers].find((d) => d.data_path === `key_blocks["${name}"].value`).modifiers.new('GENERATOR');
Object.assign(body.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'), { factor: 0.8, iterations: 4, use_only_smooth: true });
sync.view();
const files = await exportModule(world);
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'native-rig', 'a rig with an Action constraint runs on the native runtime');
assert.deepEqual(Object.keys(entity.inputs.native.meshes), ['Body'], 'the body, whose stack Babylon cannot skin, deforms on the runtime');
const groups = JSON.parse(/const ANIMATION_GROUPS = (.*);\n/.exec(files['scene.js'])[1]);
assert.deepEqual(groups.flatMap((g) => [...g.targetedAnimations.filter((t) => t.animation.keys.length > 1).map((t) => t.targetId), ...(g.bylonderTracks?.targets ?? [])]).filter((id) => /^Rig /.test(id) && !id.includes('#')), [],
  'no bone is sampled');

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const skeleton = blend.scene.getSkeletonById('Rig'), skinned = blend.scene.getMeshById(entity.inputs.mesh), drawn = blend.scene.getMeshByName('Body');
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path;
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix.multiply(skinned.computeWorldMatrix(true)));
// Main's evaluated body as the page draws it: a vertex per face corner, then each loose edge's ends, in Babylon's axes.
const mainBody = () => {
  const mesh = sync.blender.evaluatedMesh(sync.objectOf(bodyNode)), p = mesh.vert_positions;
  const drawn_ = [...mesh.corner_verts, ...Array.from(mesh.loose_edges()).flatMap((e) => [mesh.edges[e * 2], mesh.edges[e * 2 + 1]])];
  return drawn_.flatMap((v) => [p[v * 3], p[v * 3 + 2], p[v * 3 + 1]]);
};
const world_ = (m) => babylonMatrix(Array.from(m)).multiply(babylonMatrix(Array.from(rig.matrix_world)));
for (const f of FRAMES) {
  blend.set(frame, f);
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  sync.frameChanged(f);
  for (const pb of rig.pose.bones) {
    const ours = absolute(skeleton.bones.find((b) => b.name === pb.name)), theirs = world_(pb.matrix);
    const error = Math.max(...theirs.asArray().map((v, i) => Math.abs(v - ours.asArray()[i])));
    assert.ok(error < TOLERANCE, `frame ${f}: ${pb.name} is off by ${error}`);
  }
  const elbow = blend.scene.getMeshByName('Twin').morphTargetManager, target = Array.from({ length: elbow.numTargets }, (_, i) => elbow.getTarget(i)).find((t) => t.name === 'Elbow.L');
  assert.ok(Math.abs(target.influence - body.data.shape_keys.key_blocks.get('Elbow.L').value) < 2e-3, `frame ${f}: the elbow corrective ${target.influence}, Main ${body.data.shape_keys.key_blocks.get('Elbow.L').value}`);
  const ours = drawn.getVerticesData(VertexBuffer.PositionKind), theirs = mainBody();
  assert.equal(ours.length, theirs.length, "the body draws a vertex per corner of Main's");
  const error = Math.max(...theirs.map((v, i) => Math.abs(v - ours[i])));
  assert.ok(error < DEFORM_TOLERANCE, `frame ${f}: the body is off by ${error}`);
}

// The Breathe slider set through the page's control, and in Main: its shape key, whose driver the page cannot run,
// takes the value the runtime's driver gives it, which no baked sample holds.
const breatheOf = () => { const m = blend.scene.getMeshByName('Twin').morphTargetManager; return Array.from({ length: m.numTargets }, (_, i) => m.getTarget(i)).find((t) => t.name === 'Breathe').influence; };
blend.set('objects["Rig"]["breathe"]', 0.7);
const rigPointer = sync.objectOf(world.objects.find((n) => n.name === 'Rig'));
setCustomProperty(rigPointer, 'breathe', 0.7);
// A property set from code is an edit: Main evaluates its drivers again once the object is tagged.
sync.blender.tag(rigPointer, 2);
for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
sync.frameChanged(FRAMES.at(-1));
const breathe = body.data.shape_keys.key_blocks.get('Breathe').value;
assert.ok(breathe > 0.1, `the slider sets the key in Main (${breathe})`);
assert.ok(Math.abs(breatheOf() - breathe) < 2e-3, `the key follows the slider: ${breatheOf()}, Main ${breathe}`);

// A layer on the solved pose (the skeleton's onSolved, as a foot lock or a look-at): what it writes moves the deformed
// body that frame, lasts that frame only, and leaves the solved pose as it was once removed.
const onSolved = skeleton.bylonderRig?.onSolved, chest = skeleton.bones.find((b) => b.name === 'chest');
assert.ok(onSolved, 'a rig on the native runtime offers onSolved');
const render = async () => { blend.scene.render(); await blend.settled(); };
const bodyNow = () => Float32Array.from(drawn.getVerticesData(VertexBuffer.PositionKind));
const apart = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
await render();
const solvedBody = bodyNow(), layered = [];
const layer = onSolved.add(() => { chest._matrix = Matrix.RotationX(0.4).multiply(chest._matrix); layered.push(chest._matrix.clone()); });
await render();
await render();
assert.ok(apart(solvedBody, bodyNow()) > 0.01, 'a layer moves the deformed body');
assert.ok(layered[1].equalsWithEpsilon(layered[0], 1e-6), 'a layer lasts one frame: it does not pile up');
onSolved.remove(layer);
await render();
assert.ok(apart(solvedBody, bodyNow()) < 1e-5, 'without the layer the body is as solved');
blend.dispose();
written.remove();
console.log(`Export native rig: a rig with an Action constraint takes Main's pose in the page at ${FRAMES.length} frames on the native runtime, its body deformed through Corrective Smooth as Main's, its correctives run by the runtime's drivers, a layer on the solved pose moving it for one frame`);
