// Armature deform on Babylon (docs/runtimes.md, src/runtimes/armature.js): the Rigged Character example, its rig switched
// to Babylon (mapped) with its body's shape keys, morphs and skins on Babylon's skeleton to Main's evaluated deform at several poses and frames; the Runtime
// panel in the Armature tab; issues (B-Bones where shape keys move vertices, Preserve Volume as approximations, a modifier after Armature as a
// fallback) in the panel and the Info editor; Edit Mode as Blender; back to Blender as before; File > Export >
// Babylon writing a skeleton and the pose's animation that Babylon's loader skins the same; and a still Mirror before the
// Armature and Mask after it applied into the rest mesh the export skins.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, AppendSceneAsync, VertexBuffer } from '@babylonjs/core';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { blendData, idStruct, pointerStruct, structFind, setContextPointer } from '../src/python/bpy_rna.js';
import { hasArmatures } from '../src/blenkernel/armature/armature.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createCurveObjects } from '../src/editors/curve/curve-objects.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { AnimArea, RGN_TYPE_WINDOW, RGN_TYPE_HEADER } from '../src/editors/animation/anim-area.js';
import { regionPanels, panelClosedSet } from '../src/editors/interface/ui-tree.js';
import { subscribeReports } from '../src/windowmanager/wm-reports.js';
import { registerRuntimeTypes } from '../src/runtimes/runtimes.js';
import '../src/runtimes/armature.js';
import '../src/runtimes/shape-keys.js';
import { bylonderIcon, BYLONDER_ICON } from '../src/python/bpy_icons.js';
import { serializeScene } from '../src/io_scene_babylon/babylon-export.js';
import { BlenderAnimation } from '../src/blenkernel/animation/anim-blender.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';
import { packDualQuaternions, skinPoint } from '../src/io_scene_babylon/runtime/dual-quaternion-skinning.js';

if (!hasArmatures) {
  console.log('Armature runtimes: skipped, this module has no armature-api.cc');
  process.exit(0);
}
registerRuntimeTypes(bylonderIcon());

// The example opened as a project opens it (sdk.openBlend), in a world with the slices the view reads.
const scene = new Scene(new NullEngine());
const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
const objects = Object.assign([], { scene });
const world = { scene, objects, animation };
const opening = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
objects.push(...opening.readBlend(readFileSync(new URL('../examples/rigged-character/rigged-character.blend', import.meta.url)), scene).nodes);
let camera = scene.activeCamera;
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => scene.cameras, get: () => camera, set: (c) => { camera = c; } } });
world.renderSettings = createRenderSettings(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.worlds = createWorlds(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
world.curves = createCurveObjects(world);
registerObjects(animation, objects);
const selection = createSelection(scene, objects);
const sync = createMainSync({ rna: createRNA({ world, selection }), ids: animation.ids });
const { blender } = sync;
setContextPointer(blender.C);
const node = (name) => objects.find((n) => n.name === name);
const body = node('Body'), rigOb = sync.objectOf(node('Rig')), bodyOb = sync.objectOf(body);
const rig = idStruct(rigOb), bodyData = idStruct(bodyOb);
// The example opens with the rig alone selected, so its body is not outlined (overlay_outline outlines selected objects).
assert.deepEqual(selection.nodes.map((n) => n.name), ['Rig'], 'the opened example selects the rig alone');
assert.deepEqual(selection.outlined(), [], 'nothing of the rig is outlined');
const reports = [];
subscribeReports((r) => reports.push(r));

// Babylon's CPU skinning of the body against Main's evaluated (Armature-deformed) mesh, per Babylon vertex (a corner).
function skinningError() {
  const evaluated = blender.evaluatedMesh(bodyOb), p = evaluated.vert_positions, corners = evaluated.corner_verts;
  const skinned = body.getPositionData(true, true);
  let error = 0;
  for (let c = 0; c < evaluated.corners_num; c++) {
    const v = corners[c] * 3;
    error = Math.max(error, Math.abs(skinned[c * 3] - p[v]), Math.abs(skinned[c * 3 + 1] - p[v + 2]), Math.abs(skinned[c * 3 + 2] - p[v + 1]));
  }
  return error;
}
// Babylon's drawn positions, unskinned, against Main's evaluated mesh: the mesh drawn as Blender.
function drawnError() {
  const evaluated = blender.evaluatedMesh(bodyOb), p = evaluated.vert_positions, corners = evaluated.corner_verts, drawn = body.getVerticesData(VertexBuffer.PositionKind);
  let error = 0;
  for (let c = 0; c < evaluated.corners_num; c++) error = Math.max(error, Math.abs(drawn[c * 3] - p[corners[c] * 3]), Math.abs(drawn[c * 3 + 2] - p[corners[c] * 3 + 1]));
  return error;
}
const PRECISION = 1e-5;
// Pose bones set through RNA as a script sets them, then Main evaluated and drawn, as after an operator.
function pose(values) {
  for (const bone of rig.pose.bones) {
    const { rotation = [1, 0, 0, 0], location = [0, 0, 0], scale = [1, 1, 1] } = values[bone.name] ?? {};
    Object.assign(bone, { rotation_quaternion: rotation, location, scale });
  }
  blender.tag(rigOb, 2);
  sync.view();
}
const POSES = [
  {},
  { 'upper_arm.L': { rotation: [0.9, 0.3, 0.1, 0.2] }, 'forearm.L': { rotation: [0.8, 0, 0.6, 0] }, spine: { rotation: [0.95, 0.1, 0.2, 0.05] } },
  { 'thigh.R': { rotation: [0.7, 0.7, 0, 0] }, head: { rotation: [0.9, 0, 0, 0.4] }, spine: { location: [0.1, 0.2, -0.1] }, 'upper_arm.R': { scale: [1.2, 0.8, 1] } },
];

// Blender by default: nothing changes for an existing file.
assert.equal(rig.bylonder.runtime, 'BLENDER');
assert.equal(body.skeleton, null);
assert.ok(drawnError() < PRECISION);

// The Runtime panel in the Armature tab, Blender's Properties editor drawing it with the Bylonder icon.
blender.setBase(rigOb, { select: true, active: true });
const area = new AnimArea(blender, 4);
const space = pointerStruct(structFind('SpaceProperties'), 0, blenderModule.exports.anim_area_space(area.pointer) >>> 0);
area.layout(RGN_TYPE_WINDOW, 0, 0, 400, 4000);
area.layout(RGN_TYPE_HEADER, 0, 4000, 400, 26);
const nodes = (tree) => [tree, ...(tree.children ?? []).flatMap(nodes)];
function drawn(context) {
  const panels = () => area.inContext(RGN_TYPE_WINDOW, (C) => regionPanels(C)).panels;
  // The tabs exist once the editor is laid out for the context's data.
  panels();
  space.context = context;
  for (const panel of panels()) area.inContext(RGN_TYPE_WINDOW, (C) => panelClosedSet(C, panel.id, false));
  return Object.fromEntries(panels().map((panel) => [panel.id, panel.parts.flatMap((part) => nodes(part.layout))]));
}
const runtimePanel = () => drawn('DATA').DATA_PT_bylonder_armature_runtime;
assert.ok(runtimePanel(), 'the Armature tab has the Runtime panel');
const props = (panel) => panel.filter((b) => b.rna).map((b) => b.rna.prop);
assert.ok(props(runtimePanel()).includes('runtime') && props(runtimePanel()).includes('influencers'), 'it shows the runtime and Babylon\'s settings');
assert.ok(runtimePanel().some((b) => b.icon === BYLONDER_ICON), 'its header carries the Bylonder icon');
assert.ok(!drawn('DATA').DATA_PT_bylonder_armature_runtime?.some((b) => b.icon === 'ERROR'), 'no issues on Blender');

// Babylon (mapped): Babylon skins the body as Main deforms it, at several poses; linearly, Preserve Volume off until
// its own checks below.
bodyData.modifiers.get('Armature').use_deform_preserve_volume = false;
rig.bylonder.runtime = 'MAPPED';
// Its body's shape keys too, which Babylon morphs before it skins, as Blender's Armature deforms after them.
bodyData.data.shape_keys.bylonder.runtime = 'MAPPED';
sync.view();
assert.equal(body.skeleton?.name, 'Rig', "the body is skinned by the rig's skeleton");
assert.equal(body.skeleton.bones.length, 22 + 9, "the rig's bones, then the joints of the tail's 8 B-Bone segments");
assert.equal(body.numBoneInfluencers, 8, 'Automatic influencers: some vertices have more than 4 weights');
assert.deepEqual(rig.bylonder.issues.map((i) => i.kind + ' ' + i.setting), ['APPROXIMATION bpy.data.objects["Body"].modifiers["Armature"]'], 'only skinned normals differ');
for (const [i, values] of POSES.entries()) {
  pose(values);
  assert.ok(skinningError() < PRECISION, `pose ${i}: Babylon's skinning is Main's deform (${skinningError()})`);
}
assert.ok(body.getBoundingInfo().boundingBox.maximumWorld.y > 0, 'the posed mesh has bounds');
// The tail bends as Blender's B-Bone: curved, eased, rolled and scaled at its ends, its segment joints as bones.
const tail = rig.pose.bones.get('tail');
Object.assign(tail, { bbone_curveinx: 0.3, bbone_curveoutz: -0.2, bbone_easein: 1.5, bbone_rollout: 0.6, bbone_scaleout: [1.4, 1, 0.8] });
pose({ tail: { rotation: [0.9, 0.2, 0, 0.3] } });
assert.ok(skinningError() < PRECISION, `the curled tail is Main's deform (${skinningError()})`);
Object.assign(tail, { bbone_curveinx: 0, bbone_curveoutz: 0, bbone_easein: 0, bbone_rollout: 0, bbone_scaleout: [1, 1, 1] });
pose({});

// Playing an action: Blender's animation system poses the rig each frame, Babylon skins it. Keyed as I keys them, by
// Blender's keying (BlenderAnimation.keyInsert).
const keying = new BlenderAnimation(blender);
// Its constraints muted: the keys pose the rig alone, as the F-Curve unit plays them (export-pose-constraints-wasm tests them).
for (const bone of rig.pose.bones) for (const c of bone.constraints) c.mute = true;
for (const [frame, values] of [[1, POSES[0]], [11, POSES[1]], [21, POSES[2]]]) {
  sync.frameChanged(frame);
  pose(values);
  for (const bone of rig.pose.bones) for (const name of ['location', 'rotation_quaternion', 'scale']) keying.keyInsert(rigOb, `pose.bones["${bone.name}"].${name}`, -1, bone.name);
}
assert.ok(rig.animation_data?.action, 'the pose is keyed');
animation.time.configure({ frameStart: 1, frameEnd: 21 });
for (const frame of [6, 16]) {
  sync.frameChanged(frame);
  assert.ok(skinningError() < PRECISION, `frame ${frame}: the action's pose skinned as Main deforms it (${skinningError()})`);
}

// Issues: B-Bone segments where shape keys move vertices, and Preserve Volume with Dual Quaternion Skinning off, are
// approximations, shown in the panel; a modifier after Armature is a fallback: the body deforms as Blender.
reports.length = 0;
rig.bylonder.runtime = 'BLENDER';
sync.view();
rig.data.bones.get('forearm.L').bbone_segments = 4;
bodyData.modifiers.get('Armature').use_deform_preserve_volume = true;
rig.bylonder.runtime = 'MAPPED';
sync.view();
const kinds = () => rig.bylonder.issues.map((i) => i.kind + ' ' + i.setting.replace(/^bpy\.data\.objects\["(\w+)"\]\./, '$1.'));
rig.bylonder.babylon.use_dual_quaternions = false;
sync.view();
assert.deepEqual(kinds().sort(), ['APPROXIMATION Body.data.shape_keys', 'APPROXIMATION Body.modifiers["Armature"]', 'APPROXIMATION Body.modifiers["Armature"].use_deform_preserve_volume']);
assert.ok(rig.bylonder.issues.some((i) => /\d+ vertices on B-Bones keep the segments of their Basis shape/.test(i.message)), "the elbow's corrective moves vertices of the forearm's B-Bone");
assert.equal(runtimePanel().filter((b) => b.icon === 'INFO' && /Preserve Volume|B-Bone/.test(b.text)).length, 2, 'the panel lists them');
assert.equal(reports.filter((r) => /approximated/.test(r.message)).length, 3, 'switching reports them to the Info editor');
assert.ok(body.skeleton, 'an approximation still skins in Babylon');
rig.bylonder.babylon.use_dual_quaternions = true;
sync.view();
assert.ok(!rig.bylonder.issues.some((i) => /skins linearly/.test(i.message)), 'Dual Quaternion Skinning on: Preserve Volume skins as Blender');
// B-Bone Segments as Bones off: each B-Bone deforms as one segment, an approximation.
rig.bylonder.babylon.use_bbone_segments = false;
sync.view();
assert.equal(body.skeleton.bones.length, 22, 'no segment joints');
assert.deepEqual(kinds().filter((k) => /bbone/.test(k)).sort(), ['APPROXIMATION Rig.data.bones["forearm.L"].bbone_segments', 'APPROXIMATION Rig.data.bones["tail"].bbone_segments']);
rig.bylonder.babylon.use_bbone_segments = true;
bodyData.modifiers.new('Subdivision', 'SUBSURF');
blender.tag(bodyOb, 2);
sync.view();
assert.deepEqual(kinds().filter((k) => k.startsWith('FALLBACK')), ['FALLBACK Body.modifiers["Armature"].show_viewport']);
assert.equal(body.skeleton, null, 'a fallback mesh is not skinned');
assert.ok(drawnError() < PRECISION, 'it is drawn as Blender evaluates it');
assert.ok(runtimePanel().some((b) => b.icon === 'ERROR' && /Subdivision after Armature/.test(b.text)));
bodyData.modifiers.remove(bodyData.modifiers.get('Subdivision'));
rig.data.bones.get('forearm.L').bbone_segments = 1;
bodyData.modifiers.get('Armature').use_deform_preserve_volume = false;
blender.tag(bodyOb, 2);
sync.view();
assert.ok(body.skeleton && skinningError() < PRECISION, 'without them, skinned again');

// Preserve Volume: dual quaternion skinning (runtime/dual-quaternion-skinning.js), its CPU reference of the shader's
// math against Main's deform at poses of rotations and moves; scaled bones are an approximation.
function dualQuaternionError() {
  const evaluated = blender.evaluatedMesh(bodyOb), p = evaluated.vert_positions, corners = evaluated.corner_verts;
  const packed = packDualQuaternions(body.skeleton.getTransformMatrices(body)), pos = body.getVerticesData(VertexBuffer.PositionKind);
  const kinds = [[VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesWeightsKind], [VertexBuffer.MatricesIndicesExtraKind, VertexBuffer.MatricesWeightsExtraKind]];
  const [I, W] = [0, 1].map((k) => kinds.map((pair) => body.getVerticesData(pair[k])));
  const targets = Array.from({ length: body.morphTargetManager?.numTargets ?? 0 }, (_, t) => body.morphTargetManager.getTarget(t)).filter((t) => t.influence);
  let error = 0;
  for (let c = 0; c < evaluated.corners_num; c++) {
    const influences = [];
    for (let k = 0; k < body.numBoneInfluencers; k++) if (W[k >> 2][c * 4 + (k & 3)]) influences.push([I[k >> 2][c * 4 + (k & 3)], W[k >> 2][c * 4 + (k & 3)]]);
    const morphed = [0, 1, 2].map((i) => targets.reduce((v, t) => v + (t.getPositions()[c * 3 + i] - pos[c * 3 + i]) * t.influence, pos[c * 3 + i]));
    const skinned = skinPoint(packed, influences, morphed), v = corners[c] * 3;
    error = Math.max(error, ...[0, 2, 1].map((axis, k) => Math.abs(skinned[k] - p[v + axis])));
  }
  return error;
}
bodyData.modifiers.get('Armature').use_deform_preserve_volume = true;
blender.tag(bodyOb, 2);
sync.view();
assert.ok(body.metadata?.bylonderDualQuaternions, 'the body is marked for the page to skin it with dual quaternions');
for (const [i, values] of POSES.slice(0, 2).entries()) {
  pose(values);
  assert.ok(dualQuaternionError() < PRECISION, `pose ${i}: dual quaternion skinning is Main's Preserve Volume (${dualQuaternionError()})`);
  assert.ok(skinningError() > 1e-3, `pose ${i}: where linear skinning is not (${skinningError()})`);
}
pose(POSES[2]);
assert.ok(rig.bylonder.issues.some((i) => /Preserve Volume of scaled bones/.test(i.message)), 'a scaled bone is an approximation');
pose({});
bodyData.modifiers.get('Armature').use_deform_preserve_volume = false;
blender.tag(bodyOb, 2);
sync.view();
assert.ok(!body.metadata?.bylonderDualQuaternions);

// Edit Mode evaluates as Blender; leaving it, Babylon skins again.
blender.run('object.mode_set', { mode: 'EDIT' });
sync.view();
assert.equal(body.skeleton, null, 'in Edit Mode the body deforms as Blender');
assert.ok(drawnError() < PRECISION);
assert.ok(runtimePanel().some((b) => b.text === 'Edit Mode evaluates as Blender'));
blender.run('object.mode_set', { mode: 'POSE' });
sync.view();
assert.ok(body.skeleton && skinningError() < PRECISION, 'back in Pose Mode, Babylon skins it');

// File > Export > Babylon: the skeleton, the skin and the pose's animation; Babylon's loader skins it as Main deforms
// it at each frame.
const json = await serializeScene(world);
assert.deepEqual(json.skeletons.map((s) => s.name), ['Rig']);
assert.equal(json.meshes.find((m) => m.name === 'Body').skeletonId, 'Rig');
const group = json.animationGroups[0];
assert.equal(group.targetedAnimations.filter((t) => t.animation.property === '_matrix').length, 22 + 9, "every bone's pose and B-Bone joint is animated");
const loaded = new Scene(new NullEngine());
await AppendSceneAsync('data:' + JSON.stringify(json), loaded);
const loadedBody = loaded.getMeshByName('Body'), playing = loaded.animationGroups[0];
assert.equal(loadedBody.skeleton.name, 'Rig');
playing.start(false);
playing.pause();
// A loaded scene's body at a frame of its animation group, against Main's deform at that frame.
function loadedError(loadedScene, frame) {
  const group = loadedScene.animationGroups[0], mesh = loadedScene.getMeshByName('Body');
  group.goToFrame(frame);
  // Drawn: the page poses the bones its F-Curves run after Babylon's animation.
  loadedScene.render();
  mesh.skeleton.prepare(true);
  sync.frameChanged(frame);
  const evaluated = blender.evaluatedMesh(bodyOb), p = evaluated.vert_positions, corners = evaluated.corner_verts, skinned = mesh.getPositionData(true, true);
  let error = 0;
  for (let c = 0; c < evaluated.corners_num; c++) error = Math.max(error, ...[0, 2, 1].map((axis, k) => Math.abs(skinned[c * 3 + k] - p[corners[c] * 3 + axis])));
  return error;
}
for (const frame of [1, 6, 16, 21]) assert.ok(loadedError(loaded, frame) < PRECISION, `the exported file at frame ${frame} skins as Main deforms (${loadedError(loaded, frame)})`);
// Its Area light's loader keeps a reloaded scene alive in Node (no XMLHttpRequest for its LTC textures).
loaded.getEngine().dispose();
// The JavaScript export builds the same skeleton, skin and animation.
const files = await exportModule(world), ir = JSON.parse(typeof files['scene.ir.json'] === 'string' ? files['scene.ir.json'] : new TextDecoder().decode(files['scene.ir.json']));
// Their location, rotation and scale; the tail's B-Bone curves are sampled into its segment joints.
const poses = Object.values(ir.entities).filter((e) => /^pose\.bones\[.*\]\.(location|rotation|scale)/.test(e.inputs.data_path));
assert.ok(poses.length && poses.every((e) => e.implementation === 'fcurve'), "the action's pose bones run on the F-Curve unit");
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const built = blend.scene;
written.remove();
assert.equal(built.getMeshByName('Body').skeleton.name, 'Rig');
blend.playhead.pause();
for (const frame of [6, 16]) {
  blend.playhead.seek(frame);
  assert.ok(loadedError(built, frame) < PRECISION, `the .js export at frame ${frame} skins as Main deforms (${loadedError(built, frame)})`);
}
built.getEngine().dispose();

// Back to Blender: Main's evaluated mesh drawn as before, no skeleton left.
rig.bylonder.runtime = 'BLENDER';
sync.view();
assert.equal(body.skeleton, null);
assert.equal(body.getVerticesData(VertexBuffer.MatricesIndicesKind), null);
assert.equal(scene.skeletons.length, 0);
assert.ok(drawnError() < PRECISION, 'drawn as Blender evaluates it');

// Exported on Blender: the export maps it for the file and leaves the scene as it was.
const onBlender = await serializeScene(world);
assert.equal(onBlender.meshes.find((m) => m.name === 'Body').skeletonId, 'Rig');
assert.equal(body.skeleton, null);
assert.equal(scene.skeletons.length, 0);
assert.ok(drawnError() < PRECISION);

// Modifiers nothing animates around the Armature, a Mirror before it and a Mask after it, are applied into the rest mesh
// the export skins (applied-rest.js), the shape keys through them: the loaded file skins as Main deforms at each frame,
// and Main is left as it was.
const mirror = bodyData.modifiers.new('Mirror', 'MIRROR');
// Merging would join vertices the elbow's key moves apart: the rest would then hold at no value of it.
Object.assign(mirror, { use_axis: [false, true, false], use_mirror_merge: false });
bodyData.modifiers.move(bodyData.modifiers.length - 1, 0);
const mask = Object.assign(bodyData.modifiers.new('Mask', 'MASK'), { vertex_group: bodyData.vertex_groups[0].name, invert_vertex_group: true });
blender.tag(bodyOb, 2);
sync.view();
reports.length = 0;
const applied = await serializeScene(world);
assert.equal(applied.meshes.find((m) => m.name === 'Body').skeletonId, 'Rig', 'the body with a Mirror before its Armature and a Mask after it is skinned');
assert.ok(!reports.some((r) => /Body: (Armature after|Mask after)/.test(r.message)), 'and not reported as evaluated as Blender');
const reloaded = new Scene(new NullEngine());
await AppendSceneAsync('data:' + JSON.stringify(applied), reloaded);
assert.ok(reloaded.getMeshByName('Body').morphTargetManager?.numTargets, 'its shape keys are morph targets of the applied mesh');
reloaded.animationGroups[0].start(false);
reloaded.animationGroups[0].pause();
for (const frame of [1, 11, 21]) assert.ok(loadedError(reloaded, frame) < PRECISION, `the applied rest at frame ${frame} skins as Main deforms (${loadedError(reloaded, frame)})`);
reloaded.getEngine().dispose();
assert.deepEqual([...bodyData.modifiers].map((m) => [m.name, m.show_viewport]), [['Mirror', true], ['Armature', true], ['Mask', true]], 'the modifiers are shown again');
assert.equal(bodyData.show_only_shape_key, false);
assert.ok(![...blendData().objects].some((ob) => ob.name.endsWith('(rest)')), 'the applied rests are removed');
bodyData.modifiers.remove(mirror);
bodyData.modifiers.remove(mask);
// A Subdivision Surface after the Armature is applied before it, an approximation the export reports with the vertex
// counts: the subdivided rest skins as Main deforms it at the rest pose.
const subdivision = Object.assign(bodyData.modifiers.new('Subdivision', 'SUBSURF'), { levels: 1 });
blender.tag(bodyOb, 2);
sync.view();
reports.length = 0;
const subdivided = await serializeScene(world);
assert.equal(subdivided.meshes.find((m) => m.name === 'Body').skeletonId, 'Rig', 'the body with a Subdivision after its Armature is skinned');
assert.ok(reports.some((r) => r.type === 'INFO' && /Body: Subdivision applied before Armature \(\d+ vertices skinned as \d+\)/.test(r.message)), JSON.stringify(reports.map((r) => r.message)));
const smooth = new Scene(new NullEngine());
await AppendSceneAsync('data:' + JSON.stringify(subdivided), smooth);
smooth.animationGroups[0].start(false);
smooth.animationGroups[0].pause();
assert.ok(loadedError(smooth, 1) < PRECISION, `the subdivided rest at the rest pose is Main's (${loadedError(smooth, 1)})`);
smooth.getEngine().dispose();
bodyData.modifiers.remove(subdivision);
blender.tag(bodyOb, 2);
sync.view();


// File > Export's runtime choice (export-options.js): Babylon (mapped) chosen for the rig exports as on Blender, through
// the mapping (docs/runtimes.md, Export); Babylon (native), which an armature does not offer, is reported and the rig
// exports with its own.
reports.length = 0;
const chosenMapped = await serializeScene(world, { runtimes: { ARMATURE: { instances: { Rig: 'MAPPED' } } } });
assert.equal(chosenMapped.meshes.find((m) => m.name === 'Body').skeletonId, 'Rig');
assert.ok(!reports.some((r) => r.type === 'WARNING' && /exported on/.test(r.message)), 'a choice it offers is not reported');
const chosenNative = await serializeScene(world, { runtime: 'NATIVE' });
assert.equal(chosenNative.meshes.find((m) => m.name === 'Body').skeletonId, 'Rig');
assert.ok(reports.some((r) => r.type === 'WARNING' && r.message === 'Rig: Armature deform exported on Blender, Babylon (native) is not offered'), JSON.stringify(reports));
assert.equal(rig.bylonder.runtime, 'BLENDER', 'the export leaves the rig on its own runtime');
assert.equal(scene.skeletons.length, 0);

console.log('Armature runtimes: the Rigged Character skinned by Babylon as Main deforms it at 3 poses and 2 frames of an action, its B-Bone tail and Preserve Volume (dual quaternions) too, the Runtime panel, approximations and fallbacks, Edit Mode, .babylon and .js export reloaded and skinned the same');
