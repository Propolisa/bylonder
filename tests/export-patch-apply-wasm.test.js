// An open page takes a patch (runtime/scene-tables.js, BlendScene.patch, docs/data-flow.md): after a light is moved
// and the skin's color changed in the app, then a key of an action moved, the patch between the two exports turns the loaded page into the scene
// the new export loads, keeping the objects it does not change and a control the page set. A patch naming what the
// scene would not hold is not applied, reported, and the scene stays as it was; one from another version than the page
// shows loads the package again, reported (docs/data-flow.md, Atomic, versioned patches).
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { actionFCurves } from '../src/io_scene_babylon/ir-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
sync.view();
const exported = async () => { const made = await exportPackage(world); return { made, state: packageState(made) }; };
const loaded = async ({ made }) => {
  const written = writePackage(made.files), blend = await (await import(written.url)).load(new NullEngine());
  await blend.settled();
  blend.playhead.pause();
  return { blend, remove: written.remove };
};
// What a page shows of its objects, for comparing two pages.
const shown = ({ scene }) => JSON.stringify([...scene.meshes, ...scene.transformNodes, ...scene.lights].map((n) => [n.getClassName(), n.name, n.id, n.parent?.name ?? null,
  n.position.asArray().map((v) => +v.toFixed(5)), n.material?.name ?? null, n.material?.albedoColor?.asArray().map((v) => +v.toFixed(5)) ?? null, n.isEnabled(false)]).sort());

const first = await exported(), page = await loaded(first);
const body = page.blend.scene.getMeshByName('Body'), skin = body.material, rig = page.blend.scene.getTransformNodeByName('Key rig');
const path = page.blend.controls().find((c) => c.path === 'objects["Camera"].location[2]')?.path;
if (path) page.blend.set(path, 4.25);

blendData().objects.get('Key').location[0] += 0.5;
blendData().materials.get('Skin').node_tree.nodes.get('Principled BSDF').inputs.get('Base Color').default_value = [0.2, 0.5, 0.8, 1];
sync.view();
const second = await exported(), patch = tablesPatch(first.state, second.state);
assert.ok(patch.tables.nodes && patch.tables.materials?.['MA:Skin'], 'the patch moves a node and changes the skin');

const warnings = [], warn = console.warn;
console.warn = (message) => warnings.push(String(message));
const before = shown(page.blend);
const ghost = { ...patch, tables: { ...patch.tables, nodes: { ...patch.tables.nodes, 'OB:Ghost': { ...Object.values(patch.tables.nodes)[0], uniqueId: -1, material: 'MA:Ghost' } } } };
assert.equal(await page.blend.patch(ghost), page.blend, 'a patch naming a material the scene would not hold leaves the same scene');
assert.equal(shown(page.blend), before, 'as it was, with none of the patch applied');
assert.match(warnings.pop() ?? '', /not applied, the scene stays as it was: .*nodes OB:Ghost: material MA:Ghost/, 'and says why');

assert.equal(await page.blend.patch({ ...patch, buffers: second.made.buffers }), page.blend, 'a patch from the version shown applies to the same scene');
assert.notEqual(shown(page.blend), before, 'and changes it');

const fresh = await loaded(second);
if (path) fresh.blend.set(path, 4.25);
assert.equal(shown(page.blend), shown(fresh.blend), 'the patched page shows what the new export loads');
assert.equal(page.blend.scene.getMeshByName('Body'), body, 'a mesh whose material changed stays the same object');
assert.notEqual(body.material, skin, 'with the new material');
assert.equal(page.blend.scene.materials.filter((m) => m.name === 'Skin').length, 1, 'the old material gone');
assert.equal(page.blend.scene.getTransformNodeByName('Key rig'), rig, 'a moved node is moved, not made again');
if (path) assert.equal(page.blend.get(path), 4.25, 'a control the page set keeps its value');

// A key of Look's action moved: the patch replaces its animation, and the page plays the new keys at every frame.
const keys = actionFCurves(blendData().objects.get('Look').animation_data).find((fc) => fc.data_path === 'location').keyframe_points;
keys[keys.length - 1].co[1] += 0.75;
sync.view();
const third = await exported(), keyed = tablesPatch(second.state, third.state);
console.log('keyed patch:', JSON.stringify(Object.fromEntries(Object.entries(keyed.tables).map(([t, e]) => [t, Object.keys(e)]))));
assert.ok(keyed.tables.animations, 'the patch carries the new keys');
assert.equal(await page.blend.patch({ ...keyed, buffers: third.made.buffers }), page.blend, `a patch of ${Object.keys(keyed.tables).join(', ')} applies`);
const keyedPage = await loaded(third), look = (blend, frame) => {
  blend.playhead.seek(frame);
  blend.scene.render();
  return blend.scene.getTransformNodeByName('Look')?.position.asArray().map((v) => +v.toFixed(4)).join() ?? blend.scene.getMeshByName('Look')?.position.asArray().map((v) => +v.toFixed(4)).join();
};
for (const frame of [1, 12, 24, 36]) assert.equal(look(page.blend, frame), look(keyedPage.blend, frame), `Look at frame ${frame} as the new export plays it`);
keyedPage.remove();

const old = page.blend, again = await old.patch({ ...patch, base: 'u8.other' });
assert.notEqual(again, old, 'a patch from another version loads the package again');
assert.ok(old.scene.isDisposed && !again.scene.isDisposed, 'in place of the scene shown');
assert.match(warnings.pop() ?? '', /loaded again: the patch is from version u8\.other, the page shows u8\./, 'and says why');
console.warn = warn;
again.dispose();
page.remove();
fresh.remove();
console.log('Export patch apply: an open page takes a patch and shows what the new export loads, all or nothing');
process.exit(0);
