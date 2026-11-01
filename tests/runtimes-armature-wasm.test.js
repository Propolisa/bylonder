// Armature deform on Babylon (docs/runtimes.md, src/runtimes/armature.js): the Rigged Character example, its rig switched
// to Babylon (mapped), skins on Babylon's skeleton to Main's evaluated deform at several poses and frames; the Runtime
// panel in the Armature tab; issues (B-Bones, Preserve Volume as approximations, a modifier after Armature as a
// fallback) in the panel and the Info editor; Edit Mode as Blender; back to Blender as before; and File > Export >
// Babylon writing a skeleton and the pose's animation that Babylon's loader skins the same.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, AppendSceneAsync, VertexBuffer } from '@babylonjs/core';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct, pointerStruct, structFind, setContextPointer } from '../src/python/bpy_rna.js';
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
import { bylonderIcon, BYLONDER_ICON } from '../src/python/bpy_icons.js';
import { serializeScene } from '../src/io_scene_babylon/babylon-export.js';
import { BlenderAnimation } from '../src/blenkernel/animation/anim-blender.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  const skinned = body.getPositionData(true);
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
const runtimePanel = () => drawn('DATA').DATA_PT_bylonder_runtime;
assert.ok(runtimePanel(), 'the Armature tab has the Runtime panel');
const props = (panel) => panel.filter((b) => b.rna).map((b) => b.rna.prop);
assert.ok(props(runtimePanel()).includes('runtime') && props(runtimePanel()).includes('influencers'), 'it shows the runtime and Babylon\'s settings');
assert.ok(runtimePanel().some((b) => b.icon === BYLONDER_ICON), 'its header carries the Bylonder icon');
assert.ok(!drawn('DATA').DATA_PT_bylonder_runtime?.some((b) => b.icon === 'ERROR'), 'no issues on Blender');

// Babylon (mapped): Babylon skins the body as Main deforms it, at several poses.
rig.bylonder.runtime = 'MAPPED';
sync.view();
assert.equal(body.skeleton?.name, 'Rig', "the body is skinned by the rig's skeleton");
assert.equal(body.skeleton.bones.length, 11);
assert.equal(body.numBoneInfluencers, 8, 'Automatic influencers: some vertices have more than 4 weights');
assert.deepEqual(rig.bylonder.issues.map((i) => i.kind + ' ' + i.setting), ['APPROXIMATION bpy.data.objects["Body"].modifiers["Armature"]'], 'only skinned normals differ');
for (const [i, values] of POSES.entries()) {
  pose(values);
  assert.ok(skinningError() < PRECISION, `pose ${i}: Babylon's skinning is Main's deform (${skinningError()})`);
}
assert.ok(body.getBoundingInfo().boundingBox.maximumWorld.y > 0, 'the posed mesh has bounds');

// Playing an action: Blender's animation system poses the rig each frame, Babylon skins it. Keyed as I keys them, by
// Blender's keying (BlenderAnimation.keyInsert).
const keying = new BlenderAnimation(blender);
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

// Issues: B-Bone segments and Preserve Volume are approximations, shown in the panel; a modifier after Armature is a
// fallback: the body deforms as Blender.
reports.length = 0;
rig.bylonder.runtime = 'BLENDER';
sync.view();
rig.data.bones.get('forearm.L').bbone_segments = 4;
bodyData.modifiers.get('Armature').use_deform_preserve_volume = true;
rig.bylonder.runtime = 'MAPPED';
sync.view();
const kinds = () => rig.bylonder.issues.map((i) => i.kind + ' ' + i.setting.replace(/^bpy\.data\.objects\["(\w+)"\]\./, '$1.'));
assert.deepEqual(kinds().sort(), ['APPROXIMATION Body.modifiers["Armature"]', 'APPROXIMATION Body.modifiers["Armature"].use_deform_preserve_volume', 'APPROXIMATION Rig.data.bones["forearm.L"].bbone_segments']);
assert.equal(runtimePanel().filter((b) => b.icon === 'INFO' && /Preserve Volume|B-Bone/.test(b.text)).length, 2, 'the panel lists them');
assert.equal(reports.filter((r) => /approximated/.test(r.message)).length, 3, 'switching reports them to the Info editor');
assert.ok(body.skeleton, 'an approximation still skins in Babylon');
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
assert.equal(group.targetedAnimations.filter((t) => t.animation.property === '_matrix').length, 11, "every bone's pose is animated");
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
  mesh.skeleton.prepare(true);
  sync.frameChanged(frame);
  const evaluated = blender.evaluatedMesh(bodyOb), p = evaluated.vert_positions, corners = evaluated.corner_verts, skinned = mesh.getPositionData(true);
  let error = 0;
  for (let c = 0; c < evaluated.corners_num; c++) error = Math.max(error, ...[0, 2, 1].map((axis, k) => Math.abs(skinned[c * 3 + k] - p[corners[c] * 3 + axis])));
  return error;
}
for (const frame of [1, 6, 16, 21]) assert.ok(loadedError(loaded, frame) < PRECISION, `the exported file at frame ${frame} skins as Main deforms (${loadedError(loaded, frame)})`);
// Its Area light's loader keeps a reloaded scene alive in Node (no XMLHttpRequest for its LTC textures).
loaded.getEngine().dispose();
// The JavaScript export builds the same skeleton, skin and animation.
const dir = mkdtempSync(join(tmpdir(), 'bylonder-runtimes-'));
writeFileSync(join(dir, 'scene.mjs'), (await exportModule(world)).replaceAll("'@babylonjs/core'", JSON.stringify(import.meta.resolve('@babylonjs/core'))));
const built = await (await import(pathToFileURL(join(dir, 'scene.mjs')).href)).createScene(new NullEngine(), null);
rmSync(dir, { recursive: true });
assert.equal(built.getMeshByName('Body').skeleton.name, 'Rig');
built.animationGroups[0].pause();
for (const frame of [6, 16]) assert.ok(loadedError(built, frame) < PRECISION, `the .js export at frame ${frame} skins as Main deforms (${loadedError(built, frame)})`);
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

console.log('Armature runtimes: the Rigged Character skinned by Babylon as Main deforms it at 3 poses and 2 frames of an action, the Runtime panel, approximations and fallbacks, Edit Mode, .babylon and .js export reloaded and skinned the same');
