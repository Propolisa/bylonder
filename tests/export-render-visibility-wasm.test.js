// What the export draws is what Blender renders: the Rigged Character's body, disabled in viewports but rendered, as
// rigs keep their render meshes (Snow's eyes), is evaluated for the export as a render evaluates it, so its page deforms
// it as Main does; its viewport stand-in, in a collection disabled in renders, does not show in the page.
import assert from 'node:assert/strict';
import { NullEngine, VertexBuffer } from '@babylonjs/core';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const FRAME = 15, TOLERANCE = 1e-2;
const { world, sync } = openExample('rigged-character');
const data = blendData(), C = contextStruct(), body = data.objects.get('Body'), bodyNode = world.objects.find((n) => n.name === 'Body');
// An Action constraint puts the rig on the native rig runtime (export-native-rig-wasm.test.js), and a stack Babylon
// cannot skin has the runtime deform the body, which the export checks against Main's evaluated mesh.
const rig = data.objects.get('Rig');
const action = Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
  use_bone_object_action: false });
action.action = rig.animation_data.action;
sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
// A twin the skeleton skins, as the rig's skeleton lives on its skinned meshes.
const twin = data.objects.new('Twin', body.data);
C.scene.collection.objects.link(twin);
Object.assign(twin, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
twin.modifiers.new('Armature', 'ARMATURE').object = rig;
// The tail as one segment: the runtime's B-Bone deform is off by centimeters (a case sent to the clean room).
rig.data.bones.get('tail').bbone_segments = 1;
Object.assign(body.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'), { factor: 0.8, iterations: 4, use_only_smooth: true });
const proxies = data.collections.new('Proxies'), proxy = data.objects.new('Proxy', body.data);
C.scene.collection.children.link(proxies);
proxies.objects.link(proxy);
proxies.hide_render = true;
body.hide_viewport = true;
sync.view();

const files = await exportModule(world);
assert.equal(body.hide_viewport, true, 'the export leaves Disable in Viewports as it was');
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.ok(entity && Object.keys(entity.inputs.native.meshes).includes('Body'), 'the body, disabled in viewports, deforms on the runtime');

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
blend.set(blend.controls().find((c) => c.path.endsWith('.frame_current')).path, FRAME);
for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
const drawn = blend.scene.getMeshByName('Body');
assert.ok(drawn.isEnabled() && drawn.isVisible, 'the body shows');
assert.ok(!blend.scene.getMeshByName('Proxy').isVisible || !blend.scene.getMeshByName('Proxy').isEnabled(), 'its stand-in, disabled in renders, does not');

// Main's evaluated body, shown in its viewport to read it.
body.hide_viewport = false;
sync.view();
sync.frameChanged(FRAME);
const mesh = sync.blender.evaluatedMesh(sync.objectOf(bodyNode)), p = mesh.vert_positions;
const theirs = [...mesh.corner_verts].flatMap((v) => [p[v * 3], p[v * 3 + 2], p[v * 3 + 1]]), ours = drawn.getVerticesData(VertexBuffer.PositionKind);
const error = Math.max(...theirs.map((v, i) => Math.abs(v - ours[i])));
assert.ok(error < TOLERANCE, `frame ${FRAME}: the body is off Main's by ${error}`);
blend.dispose();
written.remove();
console.log(`Export render visibility: a body disabled in viewports but rendered deforms in the page as Main's (within ${error.toPrecision(2)} m at frame ${FRAME}); its stand-in disabled in renders does not show`);
