// What a patch keeps whole on an open page (docs/data-flow.md, BlendScene.patch): a patch that fails once its objects are
// swapped in loads the package again, never a mixed scene; an entry the IR's schema cannot read is not applied; a
// collection a patch adds, with a mesh in it, is a control that hides what it holds; a collection's Time Offset reaches what a patch made
// again; and the buffers a patch replaced are let go of.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
const data = blendData(), lane = data.collections.new('Lane');
contextStruct().scene.collection.children.link(lane);
lane.objects.link(data.objects.get('Body'));
// The Lane alone holds the body: an object in several collections takes the first one's offset.
contextStruct().scene.collection.objects.unlink(data.objects.get('Body'));
sync.view();
const exported = async () => { const made = await exportPackage(world); return { made, state: packageState(made) }; };
const loaded = async ({ made }) => {
  const written = writePackage(made.files), blend = await (await import(written.url)).load(new NullEngine());
  await blend.settled();
  blend.playhead.pause();
  return { blend, remove: written.remove };
};
const warnings = [], warn = console.warn;
console.warn = (message) => warnings.push(String(message));
let last = await exported();
const page = await loaded(last);
let blend = page.blend;
const next = async () => { const made = await exported(), patch = { ...tablesPatch(last.state, made.state), buffers: made.made.buffers }; last = made; return patch; };

// An entity the schema cannot read: nothing applied.
blendData().objects.get('Key').location[0] += 0.5;
sync.view();
const moved = await next(), before = blend.scene.getTransformNodeByName('Key rig').position.x;
assert.equal(await blend.patch({ ...moved, tables: { ...moved.tables, entities: { 'OB:Key/driver/x': { id: 'OB:Key' } } } }), blend, 'an unreadable entity leaves the same scene');
assert.equal(blend.scene.getTransformNodeByName('Key rig').position.x, before, 'with none of the patch applied');
assert.match(warnings.pop() ?? '', /not applied.*ir\.entities\["OB:Key\/driver\/x"\]\.type/, 'naming what it could not read');
assert.equal(await blend.patch(moved), blend, 'the same patch whole applies');

// A failure once objects are swapped in (a node hung from a bone of no skeleton): the package loads again.
const hung = { ...Object.values(moved.tables.nodes)[0], uniqueId: 999999, id: 'Hung', name: 'Hung', parentId: undefined, parentBone: { skeletonId: 'None', index: 0, meshId: 999999 } };
const failing = { base: moved.version, version: 'u8.failing', tables: { nodes: { 'OB:Hung': hung } }, buffers: {} };
const again = await blend.patch(failing);
assert.notEqual(again, blend, 'a patch failing once applied loads the package again');
assert.ok(blend.scene.isDisposed, 'in place of the mixed scene');
assert.match(warnings.pop() ?? '', /loaded again, as a patch failed once applied/, 'and says why');
again.dispose();
page.remove();

// Loaded again from the latest export, as the live loop would: offsets, flags and buffers.
const fresh = await loaded(last);
blend = fresh.blend;
const offset = 'collections["Lane"].bylonder.time_offset';
blend.set(offset, 7);
const body = data.objects.get('Body'), point = body.data.shape_keys.key_blocks.get('Breathe').data[0].co;
point[2] += 0.01;
const lights = data.collections.new('Props');
contextStruct().scene.collection.children.link(lights);
lights.objects.link(data.objects.new('Twin', body.data));
sync.view();
const oldBuffers = Object.keys(blend.buffers), patch = await next();
assert.ok(patch.tables.morphTargets && patch.tables.collections, `the patch remakes the shape keys and adds a collection: ${Object.keys(patch.tables).join(', ')}`);
assert.equal(await blend.patch(patch), blend, 'and applies');

const manager = blend.scene.getMeshByName('Body').morphTargetManager;
assert.equal(blend.playhead.offsetOf(manager.getTarget(0)), 7, "the Lane's Time Offset reaches the shape keys made again");
const hide = 'collections["Props"].hide_viewport';
assert.ok(blend.controls().some((c) => c.path === hide), 'the added collection is a control');
blend.set(hide, true);
assert.equal(blend.scene.getMeshByName('Twin')?.isVisible, false, 'which hides what it holds, a mesh the patch added');
const gone = oldBuffers.filter((key) => !(key in blend.buffers));
assert.ok(gone.length && gone.every((key) => !JSON.stringify(blend.ir).includes(key)), 'the buffers it replaced are let go of');
assert.ok(Object.keys(patch.buffers).every((key) => key in blend.buffers), 'and the new ones kept');
console.warn = warn;
fresh.remove();
console.log('Export patch integrity: a patch applies whole or the package loads again, and what it adds or makes again is indexed');
process.exit(0);
