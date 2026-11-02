// Shape keys (src/runtimes/shape-keys.js, docs/features/shape-keys.md): the Shape Keys example opened as a project
// opens it; Blender's Shape Keys panel and operators (object.shape_key_add, _move, _remove, _clear, mesh.blend_from_shape);
// keyed values; the mesh drawn as Main evaluates it on Blender; on Babylon (mapped) a MorphTargetManager whose blend is
// Main's evaluated mesh at keyed frames, only its influences changing per frame; fallbacks, Edit Mode and pinning; and
// File > Export > Babylon writing the targets and the influences' animation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, AppendSceneAsync, VertexBuffer } from '@babylonjs/core';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct, pointerStruct, structFind, setContextPointer, pointerOf } from '../src/python/bpy_rna.js';
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
import { registerRuntimeTypes } from '../src/runtimes/runtimes.js';
import '../src/runtimes/shape-keys.js';
import { bylonderIcon, BYLONDER_ICON } from '../src/python/bpy_icons.js';
import { serializeScene } from '../src/io_scene_babylon/babylon-export.js';
import { BlenderAnimation } from '../src/blenkernel/animation/anim-blender.js';

registerRuntimeTypes(bylonderIcon());

const scene = new Scene(new NullEngine());
const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
const objects = Object.assign([], { scene });
const world = { scene, objects, animation };
const opening = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
objects.push(...opening.readBlend(readFileSync(new URL('../examples/shape-keys/shape-keys.blend', import.meta.url)), scene).nodes);
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
world.mainSync = sync;
const { blender } = sync;
setContextPointer(blender.C);
const blob = objects.find((n) => n.name === 'Blob'), blobOb = sync.objectOf(blob), ob = idStruct(blobOb), key = ob.data.shape_keys;
animation.time.configure({ frameStart: 1, frameEnd: 48 });

// Babylon's drawn positions (morphed on the CPU as the GPU morphs them) against Main's evaluated mesh, per corner.
function drawnError() {
  const evaluated = blender.evaluatedMesh(blobOb), p = evaluated.vert_positions, corners = evaluated.corner_verts;
  const drawn = blob.getPositionData(false, true);
  let error = 0;
  for (let c = 0; c < evaluated.corners_num; c++) error = Math.max(error, ...[0, 2, 1].map((axis, k) => Math.abs(drawn[c * 3 + k] - p[corners[c] * 3 + axis])));
  return error;
}
const PRECISION = 1e-5;
const names = () => [...key.key_blocks].map((kb) => kb.name);

// The example's keys as Blender saved them, and Blender's evaluation of them drawn.
assert.deepEqual(names(), ['Basis', 'Squash', 'Stretch', 'Bulge', 'Wobble']);
assert.equal(key.key_blocks.get('Bulge').vertex_group, 'Top');
assert.ok(key.key_blocks.get('Wobble').mute);
assert.equal(key.bylonder.runtime, 'BLENDER', 'Blender by default');
for (const frame of [1, 8, 14]) {
  sync.frameChanged(frame);
  assert.ok(drawnError() < PRECISION, `frame ${frame}: drawn as Main evaluates it (${drawnError()})`);
}
assert.ok(Math.abs(key.key_blocks.get('Stretch').value - 1) < 1e-6, 'frame 14: Stretch keyed to 1');

// The Shape Keys panel in the Mesh tab, with the Runtime panel after it.
blender.setBase(blobOb, { select: true, active: true });
const area = new AnimArea(blender, 4);
const space = pointerStruct(structFind('SpaceProperties'), 0, blenderModule.exports.anim_area_space(area.pointer) >>> 0);
area.layout(RGN_TYPE_WINDOW, 0, 0, 400, 4000);
area.layout(RGN_TYPE_HEADER, 0, 4000, 400, 26);
const nodes = (tree) => [tree, ...(tree.children ?? []).flatMap(nodes)];
function drawn(context) {
  const panels = () => area.inContext(RGN_TYPE_WINDOW, (C) => regionPanels(C)).panels;
  panels();
  space.context = context;
  for (const panel of panels()) area.inContext(RGN_TYPE_WINDOW, (C) => panelClosedSet(C, panel.id, false));
  return Object.fromEntries(panels().map((panel) => [panel.id, panel.parts.flatMap((part) => nodes(part.layout))]));
}
const data = drawn('DATA'), props = (panel) => panel.filter((b) => b.rna).map((b) => b.rna.prop);
assert.ok(data.DATA_PT_shape_keys, 'the Mesh tab has the Shape Keys panel');
for (const prop of ['value', 'slider_min', 'slider_max', 'vertex_group', 'relative_key', 'show_only_shape_key', 'use_shape_key_edit_mode']) {
  assert.ok(props(data.DATA_PT_shape_keys).includes(prop), `it shows ${prop}`);
}
const runtimePanel = () => drawn('DATA').DATA_PT_bylonder_shape_keys_runtime;
assert.ok(runtimePanel()?.some((b) => b.icon === BYLONDER_ICON), 'the Runtime panel, with the Bylonder icon');

// Blender's operators on the keys.
const run = (idname, values = {}) => assert.ok(blender.run(idname, values).status & 4, `${idname} runs`);
ob.active_shape_key_index = 4;
run('object.shape_key_add', { from_mix: true });
assert.deepEqual(names(), ['Basis', 'Squash', 'Stretch', 'Bulge', 'Wobble', 'Key 5']);
run('object.shape_key_move', { type: 'UP' });
assert.equal(names()[4], 'Key 5');
run('object.shape_key_remove', {});
assert.deepEqual(names(), ['Basis', 'Squash', 'Stretch', 'Bulge', 'Wobble']);
// Blend from Shape in Edit Mode: the active key's vertices pulled toward Stretch.
ob.active_shape_key_index = 4;
run('object.mode_set', { mode: 'EDIT' });
run('mesh.select_all', { action: 'SELECT' });
run('mesh.blend_from_shape', { shape: 'Stretch', blend: 1, add: false });
run('object.mode_set', { mode: 'OBJECT' });
const co = (name, i) => Array.from(key.key_blocks.get(name).data[i].co);
assert.deepEqual(co('Wobble', 100), co('Stretch', 100), 'Wobble took Stretch\'s shape');

// Babylon (mapped): a MorphTargetManager on the Mesh Main holds, its blend Main's evaluated mesh at keyed frames.
key.bylonder.runtime = 'MAPPED';
sync.frameChanged(1);
const manager = blob.morphTargetManager;
assert.equal(manager?.numTargets, 4, 'one target per key but Basis');
assert.deepEqual(key.bylonder.issues.map((i) => i.kind), ['APPROXIMATION'], 'only the normals differ');
const positions = blob.getVertexBuffer(VertexBuffer.PositionKind);
for (const frame of [4, 8, 11, 14, 30]) {
  sync.frameChanged(frame);
  assert.ok(drawnError() < PRECISION, `frame ${frame}: Babylon's blend is Main's evaluation (${drawnError()})`);
}
assert.equal(blob.morphTargetManager, manager, 'frames change the influences only');
assert.equal(blob.getVertexBuffer(VertexBuffer.PositionKind), positions, 'the mesh is not drawn again');
// A key's value dragged, a key muted and pinned, as the panel sets them.
key.key_blocks.get('Wobble').mute = false;
key.key_blocks.get('Wobble').value = 0.6;
blender.tag(pointerOf(key)[2], 0);
sync.view();
assert.ok(drawnError() < PRECISION, `an unmuted key blends (${drawnError()})`);
ob.show_only_shape_key = true;
ob.active_shape_key_index = 3;
blender.tag(blobOb, 2);
sync.view();
assert.ok(drawnError() < PRECISION, `the pinned Bulge alone, through its vertex group (${drawnError()})`);
ob.show_only_shape_key = false;
blender.tag(blobOb, 2);
sync.view();

// Fallbacks: a modifier after the keys, and Edit Mode, evaluate as Blender.
ob.modifiers.new('Subdivision', 'SUBSURF');
blender.tag(blobOb, 2);
sync.view();
assert.equal(blob.morphTargetManager, null, 'a fallback mesh has no targets');
assert.ok(key.bylonder.issues.some((i) => i.kind === 'FALLBACK' && /Subdivision after the shape keys/.test(i.message)));
assert.ok(drawnError() < PRECISION, 'it is drawn as Blender evaluates it');
ob.modifiers.remove(ob.modifiers.get('Subdivision'));
blender.tag(blobOb, 2);
sync.view();
assert.ok(blob.morphTargetManager && drawnError() < PRECISION, 'without it, morphed again');
run('object.mode_set', { mode: 'EDIT' });
sync.view();
assert.equal(blob.morphTargetManager, null, 'in Edit Mode the mesh evaluates as Blender');
run('object.mode_set', { mode: 'OBJECT' });
sync.view();
assert.ok(blob.morphTargetManager && drawnError() < PRECISION, 'back in Object Mode, Babylon blends it');

// A keyed value (I over the value), as Blender's keying inserts it.
const keying = new BlenderAnimation(blender);
sync.frameChanged(20);
key.key_blocks.get('Bulge').value = 1;
keying.keyInsert(pointerOf(key)[2], 'key_blocks["Bulge"].value');
sync.frameChanged(40);
key.key_blocks.get('Bulge').value = 0;
keying.keyInsert(pointerOf(key)[2], 'key_blocks["Bulge"].value');
sync.frameChanged(30);
assert.ok(Math.abs(key.key_blocks.get('Bulge').value - 0.5) < 0.05, 'the keyed value animates');
assert.ok(drawnError() < PRECISION, `and Babylon blends it (${drawnError()})`);

// File > Export > Babylon: the targets and their influences' animation; the loaded file blends as Main evaluates.
const json = await serializeScene(world);
const exported = json.meshes.find((m) => m.name === 'Blob');
assert.ok(exported.morphTargetManagerId !== undefined, 'the mesh has its morph targets');
const loaded = new Scene(new NullEngine());
await AppendSceneAsync('data:' + JSON.stringify(json), loaded);
const loadedBlob = loaded.getMeshByName('Blob'), group = loaded.animationGroups[0];
assert.equal(loadedBlob.morphTargetManager.numTargets, 4);
group.start(false);
group.pause();
for (const frame of [8, 30]) {
  group.goToFrame(frame);
  sync.frameChanged(frame);
  const evaluated = blender.evaluatedMesh(blobOb), p = evaluated.vert_positions, corners = evaluated.corner_verts, morphed = loadedBlob.getPositionData(false, true);
  let error = 0;
  for (let c = 0; c < evaluated.corners_num; c++) error = Math.max(error, ...[0, 2, 1].map((axis, k) => Math.abs(morphed[c * 3 + k] - p[corners[c] * 3 + axis])));
  assert.ok(error < PRECISION, `the exported file at frame ${frame} blends as Main evaluates (${error})`);
}
loaded.getEngine().dispose();

// Back to Blender: Main's evaluated mesh drawn, no targets left.
key.bylonder.runtime = 'BLENDER';
sync.view();
assert.equal(blob.morphTargetManager, null);
assert.ok(drawnError() < PRECISION);

console.log('Shape keys: the panel and operators, keyed values, Babylon\'s morph targets blending as Main evaluates at keyed frames with only influences changing, pinning, fallbacks, Edit Mode, and the .babylon export');
