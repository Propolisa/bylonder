// tags: live
// Value edits reach the Game area on the next frame (src/editors/space_package/package-preview.js): the IDs Blender's
// depsgraph updates give their controls' values, which every run and every copy of it sets through the binds the
// package carries, with no export in between. The scoped export behind them reconciles: its patch leaves the run as a
// fresh load of a full export shows it, and one that disagrees with a value set fast loads the run fresh.
// Law, on Rigged Character: a transform, a material colour, a light, a shape key, whether an object casts shadows and a camera's lens and sensor.
import assert from 'node:assert/strict';
import * as core from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { createPackagePreview } from '../src/editors/space_package/package-preview.js';
import { createGameRun, setControls } from '../src/editors/space_game/game-run.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState } from '../src/io_scene_babylon/scene-patch.js';
import '../src/draw/draw-view.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const appModule = async (source) => (source === '@babylonjs/core' ? core : import(new URL(`../src/${source}`, import.meta.url).href));
const { world, sync } = openExample('rigged-character');
world.mainSync = sync;
// Breathe's value is its driver's in the example: muted, an edit holds, as in Blender.
[...blendData().shape_keys.get('Key').animation_data.drivers].find((fc) => fc.data_path === 'key_blocks["Breathe"].value').mute = true;
sync.view();
const game = createGameRun({ appModule, exportAgain: () => preview.reload(), engine: () => new core.NullEngine() });
let written, asset, copy, exports = 0, posted = Promise.resolve();
// Once the patches asked for are sent and applied.
// The app's idle wait, run when the test settles: what is exported before it is exported at once.
const idles = [];
const settled = async () => { while (idles.length) idles.shift()(); await preview.settled(); await posted; };
const statuses = [], fresh = [];
// The runs: the Game area's, and the scene added to a scene of a page's own with a copy made of it.
const preview = createPackagePreview({ world, idle: (run) => idles.push(run), report: (status) => statuses.push(status),
  set: (changes) => { game.set(changes); setControls(asset, changes); },
  post: (patch, reload) => {
    fresh.push(reload);
    posted = reload ? game.reset(preview.state) : game.patch(patch, preview.state).then((applied) => assert.equal(applied, true, 'the run takes the patch'));
  },
  publish: async (made, tables) => {
    exports++;
    written = writePackage(made.files);
    await game.play(made, tables, new URL('./', written.url).href);
    return written.url;
  } });
await preview.reload();
const module = await import(written.url);
asset = await module.load({ scene: new core.Scene(new core.NullEngine()) });
copy = await module.load({ instance: asset });
assert.ok(asset.copies.has(copy), 'a copy is linked to what it copies');

// What a frame draws of each edited item, by run.
const find = (list, name) => list.find((item) => item.name === name);
const shown = (run) => {
  // A copy holds no lights of its own: its scene's are the run's.
  const { scene } = run, morph = find(scene.meshes, 'Body')?.morphTargetManager?.getTargetByName('Breathe'), light = find(scene.lights, 'Key');
  return {
    transform: find(scene.transformNodes, 'Key rig')?.position.asArray(),
    color: find(scene.materials, 'Skin')?.albedoColor.asArray(),
    light: light && [light.intensity, ...light.diffuse.asArray()],
    shape: morph?.influence,
    // The camera's field of view, as its frame fits it (rounded: Blender's and the bind's arithmetic differ in the last bits).
    lens: find(scene.cameras, 'Camera') && +find(scene.cameras, 'Camera').fov.toFixed(6),
    // Whether the light casts shadows at all.
    shadows: light?.shadowEnabled,
    // Whether the body casts the light's shadow (a light none casts on has no shadow map).
    shadow: light && !!light.getShadowGenerator()?.getShadowMap().renderList.some((mesh) => mesh.name === 'Body'),
  };
};
const runs = () => [game.blend, asset, copy];
const objects = blendData().objects, skin = blendData().materials.get('Skin').node_tree.nodes.get('Principled BSDF').inputs[0];
const EDITS = {
  transform: () => { objects.get('Key').location[0] += 0.5; },
  color: () => { skin.default_value[0] = 0.9; },
  light: () => { objects.get('Key').data.energy *= 2; objects.get('Key').data.color[1] = 0.5; objects.get('Key').data.exposure = 0.5; },
  shape: () => { blendData().shape_keys.get('Key').key_blocks.get('Breathe').value = 0.75; },
  shadow: () => { objects.get('Body').visible_shadow = false; },
  shadows: () => { objects.get('Key').data.use_shadow = false; },
  lens: () => { objects.get('Camera').data.lens *= 1.5; objects.get('Camera').data.sensor_width = 30; },
};
for (const [kind, edit] of Object.entries(EDITS)) {
  const before = runs().map((run) => shown(run)[kind]), exported = exports, patched = fresh.length;
  const start = performance.now();
  edit();
  sync.view();
  const ms = performance.now() - start;
  runs().forEach((run, i) => {
    if (before[i] === undefined) return;
    assert.notDeepEqual(shown(run)[kind], before[i], `the ${kind} edit shows on the next frame of run ${i}`);
  });
  assert.ok(exports === exported && fresh.length === patched, `the ${kind} edit needs no export`);
  console.log(`${kind}: edit to frame ${ms.toFixed(1)} ms`);
  const fast = shown(game.blend)[kind];
  preview.changed();
  await settled();
  assert.deepEqual(fresh.slice(patched), [false], `the export behind the ${kind} edit agrees: patched, not loaded fresh`);
  assert.deepEqual(shown(game.blend)[kind], fast, `the ${kind} edit shows as the export behind it does`);
}
assert.notEqual(shown(game.blend).shape, undefined, 'the shape key is checked in the game');

// A setting the run remakes (an area light's size) is exported at once, with no idle wait, and edits made meanwhile, as a
// drag makes them, fold into one export after it with their latest values.
const key = objects.get('Key').data, before = fresh.length;
for (const step of [1.1, 1.2, 1.3]) {
  key.size *= step;
  sync.view();
}
await settled();
assert.ok(fresh.length - before >= 1 && fresh.length - before <= 2, `three steps of a drag export at most twice (${fresh.length - before})`);
assert.equal(+find(game.blend.scene.lights, 'Key').width.toFixed(5), +key.size.toFixed(5), 'the run shows the last size');

// Reconciled: the live tables are a full export's, and the patched run shows what a fresh run of them does.
const full = packageState(await exportPackage(world, {}));
assert.equal(preview.state.version, full.version, 'the reconciled tables equal a full export');
const patchedRun = shown(game.blend), freshRun = shown(await game.reset(preview.state));
assert.deepEqual(patchedRun, freshRun, 'the patched run shows what a fresh run does');

// A value set fast that the export behind it does not give (Main changed with no evaluation between): loaded fresh.
objects.get('Key').location[1] += 0.25;
sync.view();
objects.get('Key').location[1] += 0.25;
const loaded = game.blend;
preview.changed();
await settled();
assert.equal(fresh.at(-1), true, 'the export disagreeing with a fast set loads the run fresh');
assert.ok(loaded.scene.isDisposed && game.blend !== loaded, 'no partial state: a fresh run');
assert.match(statuses.at(-1), /^Loaded fresh: objects\["Key"\]\.location\[1\]/, 'and the header says so');

// An edit the runs do not show (a camera's sensor fit) is exported at once, with no idle wait.
const exportedBefore = fresh.length;
objects.get('Camera').data.sensor_fit = 'VERTICAL';
sync.view();
preview.changed();
await preview.settled();
await posted;
assert.equal(fresh.length, exportedBefore + 1, 'an edit the runs do not show is exported at once');
idles.length = 0;

// The game never writes into the editor's data.
const writes = sync.writes;
game.blend.set('objects["Key"].location[0]', 9);
sync.view();
assert.equal(sync.writes, writes, 'a set in the game leaves Main alone');
assert.notEqual(objects.get('Key').location[0], 9);

game.dispose();
written.remove();
console.log('Instant edits: transform, material colour, light, shape key, shadow casting and camera lens on the next frame in every run and copy; the export reconciles');
process.exit(0);
