// tags: live
// The Game area's run in the app's realm (src/editors/space_game/game-run.js): the package's scene.js linked to the
// app's own modules, so the run's objects are of the app's one Babylon; its IR is the live package's object, frozen,
// never written as text, parsed or validated; an edit reaches the run as a patch of references; Reset gives a fresh run
// sharing the same IR; a patch in doubt loads it fresh, by a new export where no patch reaches.
import assert from 'node:assert/strict';
import * as core from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { createPackagePreview } from '../src/editors/space_package/package-preview.js';
import { createGameRun } from '../src/editors/space_game/game-run.js';
import { packageState } from '../src/io_scene_babylon/scene-patch.js';
import '../src/draw/draw-view.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

// The app's modules by src/ path, as the Game area's import.meta.glob gives them; scene.js's one read of a file's IR
// counted.
let irReads = 0;
const appModule = async (source) => {
  if (source === '@babylonjs/core') return core;
  const module = await import(new URL(`../src/${source}`, import.meta.url).href);
  return source.endsWith('runtime/blend-scene.js') ? { ...module, readSceneIR: (raw) => { irReads++; return module.readSceneIR(raw); } } : module;
};
const parse = JSON.parse;
let irParses = 0;
JSON.parse = (text, ...rest) => { if (String(text).includes('"bylonder-ir"')) irParses++; return parse(text, ...rest); };

const { world, sync } = openExample('rigged-character');
world.mainSync = sync;
sync.view();
const appEngine = new core.NullEngine(), game = createGameRun({ appModule, exportAgain: () => preview.reload(), engine: () => new core.NullEngine() });
let made, written;
const patches = [];
const preview = createPackagePreview({ world, idle: (run) => run(), post: (patch) => patches.push(patch),
  publish: async (exported, tables) => {
    made = exported;
    written = writePackage(made.files);
    await game.play(made, tables, new URL('./', written.url).href);
    return written.url;
  } });
await preview.reload();
const a = game.blend;
assert.ok(a.scene instanceof core.Scene && a.scene.meshes.every((m) => m instanceof core.AbstractMesh) && a.scene.materials.every((m) => m instanceof core.Material),
  "the run's objects are the app's Babylon's: one Babylon");
assert.ok(Object.isFrozen(made.ir) && a.ir.ids === made.ir.ids, "the run's IR is the live package's object, frozen");
// The run has an engine of its own, which the app's Babylon-wide extensions leave alone: its materials carry no app plugin.
const plugins = (material) => material.pluginManager?._plugins.map((p) => p.name) ?? [];
assert.ok(game.engine !== appEngine && core.EngineStore.LastCreatedEngine !== game.engine && core.EngineStore.LastCreatedScene !== a.scene, "Babylon's last created engine and scene stay the app's");
assert.ok(plugins(new core.PBRMaterial('app', new core.Scene(appEngine))).includes('BlenderView') && !a.scene.materials.some((m) => plugins(m).includes('BlenderView')), "the game's materials carry no app plugin");

const objects = blendData().objects, at = (blend) => blend.scene.getTransformNodeByName('Key rig').position.asArray();
const edit = async (change) => {
  change();
  sync.view();
  preview.changed();
  await preview.settled();
  assert.equal(await game.patch(patches.at(-1), preview.state), true, 'the run takes the patch');
};
const was = at(a);
// The app's sync changes the app's objects alone, though the game's carry the same names.
objects.get('Key').location[0] += 0.5;
sync.view();
assert.deepEqual(at(a), was, "an edit in the app leaves the game's object of the same name alone until the patch");
await edit(() => {});
assert.equal(game.blend, a, 'patched in place');
assert.notDeepEqual(at(a), was, 'the move reaches the run');
await edit(() => { objects.get('Key').data.energy *= 2; });

const shown = at(a), b = await game.reset(preview.state);
assert.ok(b !== a && a.scene.isDisposed, 'Reset drops the run and loads a fresh one');
assert.deepEqual(at(b), shown, 'the fresh run shows the edits');
for (const table of ['meshes', 'graphs', 'collections']) assert.equal(b.ir[table], made.ir[table], `both runs share the IR's ${table}`);
// A patch the run cannot take (from another version) leaves no partial run: the run is loaded fresh at the live version.
assert.equal(await game.patch(patches[0], preview.state), false);
assert.ok(b.scene.isDisposed && game.blend.version === preview.state.version, 'loaded fresh');
// Live tables no patch reaches (the scene's own settings): Reset never fails, it exports the scene again and plays that.
const exported = made, settings = { ...preview.state.tables, scene: Object.fromEntries(Object.entries(preview.state.tables.scene).map(([key, entry]) => [key, { ...entry, code: ['changed'] }])) };
await game.reset(packageState({ tables: settings, buffers: preview.state.buffers }));
assert.ok(made !== exported && game.blend.version === preview.state.version, 'Reset where a patch cannot reach: a fresh export, played');
assert.equal(irReads + irParses, 0, 'nothing parsed or validated the IR');

game.dispose();
written.remove();
JSON.parse = parse;
console.log('Game run: one Babylon, the live IR by reference, edits as patches, Reset fresh');
process.exit(0);
