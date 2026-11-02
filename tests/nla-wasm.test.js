// The Nonlinear Animation editor (SPACE_NLA, editors/animation/anim-editor.js): the NLA example opened as a project
// opens it, its strips evaluated by Blender's animation system as Blender 5.2.3 evaluates them (examples/nla/nla.py);
// the editor's area in the module with its tracks listed, its main region drawn by nla_draw.cc (strips, the action
// line's keyframe shapes), the sidebar's strip panels, and Blender's operators: push down, tweak mode, split,
// duplicate, a strip's blending and influence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderMain, newOperator } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct, setContextPointer, pointerOf } from '../src/python/bpy_rna.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createSelection } from '../src/editors/object/selection.js';
import { BlenderAnimation } from '../src/blenkernel/animation/anim-blender.js';
import { AnimArea, SPACE_NLA, RGN_TYPE_WINDOW, RGN_TYPE_CHANNELS, RGN_TYPE_UI, OPERATOR_FINISHED } from '../src/editors/animation/anim-area.js';
import { regionPanels, categorySet } from '../src/editors/interface/ui-tree.js';

const scene = new Scene(new NullEngine());
const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
const objects = Object.assign([], { scene });
const world = { scene, objects, animation };
const opening = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
objects.push(...opening.readBlend(readFileSync(new URL('../examples/nla/nla.blend', import.meta.url)), scene).nodes);
const sync = createMainSync({ rna: createRNA({ world, selection: createSelection(scene, objects) }), ids: animation.ids });
const { blender } = sync;
setContextPointer(blender.C);
const boxOb = sync.objectOf(objects.find((n) => n.name === 'Box')), box = idStruct(boxOb), adt = box.animation_data;
animation.time.configure({ frameStart: 1, frameEnd: 96 });
const near = (a, b) => Math.abs(a - b) < 1e-3;

// Blender 5.2.3's evaluation of the example (nla.py's file, frame_set in Blender): location and Z rotation.
const REFERENCE = [[1, -3, 0.5, 0], [5, -2.969, 1.1671, 0], [12, -2.7773, 1.05, 0], [30, -1.664, 0.5473, 0], [60, 1.0682, 0.5, 0.3671], [80, 2.5467, 0.5, 0.7854]];
const evaluatedAt = (frame) => { sync.frameChanged(frame); return [box.location[0], box.location[2], box.rotation_euler[2]]; };
for (const [frame, x, z, rz] of REFERENCE) {
  const [ex, ez, erz] = evaluatedAt(frame);
  assert.ok(near(ex, x) && near(ez, z) && near(erz, rz), `frame ${frame}: the strips evaluate as Blender's (${ex}, ${ez}, ${erz})`);
}
assert.deepEqual([...adt.nla_tracks].map((t) => t.name), ['Slide', 'Hop', 'Turn']);

// The editor's area: the object, its tracks and its action line listed, as the channel region lists them.
const area = new AnimArea(blender, SPACE_NLA);
area.layout(RGN_TYPE_CHANNELS, 0, 0, 200, 300);
area.layout(RGN_TYPE_WINDOW, 200, 0, 800, 300);
area.show(RGN_TYPE_UI, true);
area.layout(RGN_TYPE_UI, 1000, 0, 280, 300);
area.sync();
blender.setBase(boxOb, { select: true, active: true });
const channels = () => area.channels().map((c) => c.name);
assert.deepEqual(channels(), ['Box', '<No Action>', 'Turn', 'Hop', 'Slide']);
assert.ok(area.settings.flag & (1 << 8), 'the space shows markers (SNLA_SHOW_MARKERS)');

// Its main region, drawn whole by Blender: each strip's name and the frame numbers.
const drawn = () => area.draw(RGN_TYPE_WINDOW).draw;
const texts = drawn().filter((op) => op.op === 'text').map((op) => op.text);
for (const name of ['Slide', 'Hop', 'Turn']) assert.ok(texts.some((t) => t.includes(name)), `the ${name} strip is drawn`);
assert.ok(drawn().some((op) => op.op === 'roundbox'), 'strips are round boxes');

const run = (idname, props = {}, region = RGN_TYPE_WINDOW) => {
  const status = area.run(newOperator(idname, props), region);
  assert.ok(status & OPERATOR_FINISHED, `${idname} finished (${status})`);
};
const strips = () => [...adt.nla_tracks].flatMap((t) => [...t.strips].map((s) => `${t.name}:${s.name}`));

// A new action keyed, then pushed down onto a new track; its keys drawn as keyframe shapes on the action line first.
const keying = new BlenderAnimation(blender);
sync.frameChanged(1);
keying.keyInsert(boxOb, 'scale', 2);
sync.frameChanged(20);
box.scale = [1, 1, 1.5];
keying.keyInsert(boxOb, 'scale', 2);
assert.ok(adt.action, 'keying made an action');
const keys = drawn().filter((op) => op.op === 'keys');
assert.equal(keys.length, 1, "the action line's keys");
assert.equal(keys[0].points.length / 2, 2, 'two keyframe shapes');
assert.equal(keys[0].keys.length, 20, 'each with size, fill, outline and flags');
const line = area.channels().findIndex((c) => c.name === adt.action.name);
run('nla.action_pushdown', { track_index: line }, RGN_TYPE_CHANNELS);
assert.equal(adt.action, null, 'pushed down');
assert.equal(strips().length, 4, 'into a strip on the top track, where it fits');

// Selecting a strip and the sidebar's panels for it.
// A click on a strip (nla.click_select), at a frame of a track's row (ED_anim_api.hh's NLATRACK_FIRST_TOP, _HEIGHT and
// _STEP at 1x scale): it becomes the selected, active strip.
function clickStrip(track, frame) {
  const row = area.channels().findIndex((c) => c.name === track), top = -area.metrics().scrubHeight - 2;
  const [x, y] = area.v2d().toRegion(frame, top - row * 26 - 12);
  area.run(newOperator('nla.click_select', { deselect_all: true }), RGN_TYPE_WINDOW, { type: 'LEFTMOUSE', value: 'PRESS', x, y });
  // It waits for the release as a select's invoke does (WM_generic_select_modal).
  if (area.modal) area.handle({ type: 'LEFTMOUSE', value: 'RELEASE', x, y });
}
clickStrip('Hop', 10);
assert.ok(adt.nla_tracks.get('Hop').strips[0].select && adt.nla_tracks.active.name === 'Hop');
const panels = area.inContext(RGN_TYPE_UI, (C) => regionPanels(C)), tabs = panels.categories;
assert.ok(tabs.includes('Strip'), `the sidebar has the Strip tab (${tabs})`);
const strip = area.inContext(RGN_TYPE_UI, (C) => { categorySet(C, 'Strip'); return regionPanels(C).panels.map((p) => p.id); });
for (const id of ['NLA_PT_stripname', 'NLA_PT_properties']) assert.ok(strip.includes(id), `${id} in the Strip tab (${strip})`);

// Blending and influence set as the panel sets them: Hop replaces instead of adding.
const hop = adt.nla_tracks.get('Hop').strips[0];
hop.blend_type = 'REPLACE';
assert.ok(evaluatedAt(5)[1] < 0.7, 'a replacing Hop drops the base height');
hop.blend_type = 'ADD';
assert.ok(near(evaluatedAt(5)[1], 1.1671));

// Tweak mode on the selected strip edits its action, then leaves it.
run('nla.tweakmode_enter');
assert.ok(adt.use_tweak_mode, 'in tweak mode');
assert.equal(adt.action.name, 'Hop');
run('nla.tweakmode_exit');
assert.ok(!adt.use_tweak_mode);

// Split and duplicate the selected strip.
sync.frameChanged(20);
run('nla.split');
assert.equal(adt.nla_tracks.get('Hop').strips.length, 2, 'split at its middle');
clickStrip('Slide', 60);
run('nla.duplicate', { linked: false });
assert.equal(strips().filter((s) => s.endsWith('Slide.001')).length, 1, 'duplicated onto a new track');
area.dispose();

console.log(`NLA: the example's strips evaluate as Blender 5.2.3's at ${REFERENCE.length} frames, the editor lists its tracks, draws its strips and keys, shows the strip panels, and pushes down, tweaks, splits and duplicates`);
