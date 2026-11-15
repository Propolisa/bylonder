// tags: live
// The scene's modifier stack for packages (src/io_scene_babylon/export-settings.js, `scene.bylonder.export_evaluation`):
// Render by default, as exports were; Viewport leaves off what Disable in Viewports leaves off. Switching it as the Game
// area's header does (a new export, the run loaded fresh) gives the package a full export with that setting gives.
import assert from 'node:assert/strict';
import * as core from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { createPackagePreview } from '../src/editors/space_package/package-preview.js';
import { createGameRun } from '../src/editors/space_game/game-run.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState } from '../src/io_scene_babylon/scene-patch.js';
import { exportEvaluation, registerExportSettings, setExportEvaluation } from '../src/io_scene_babylon/export-settings.js';
import '../src/draw/draw-view.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const appModule = async (source) => (source === '@babylonjs/core' ? core : import(new URL(`../src/${source}`, import.meta.url).href));
const { world, sync } = openExample('rigged-character');
world.mainSync = sync;
registerExportSettings();
// The body's Armature modifier off in viewports, on in renders, as the Game page's picture has it: the two stacks differ.
const body = blendData().objects.get('Body'), modifier = body.modifiers[0];
modifier.show_viewport = false;
sync.view();
assert.equal(exportEvaluation(world), 'RENDER', 'Render by default, as exports were');

const version = async () => packageState(await exportPackage(world, {})).version;
const render = await version();
setExportEvaluation(world, 'VIEWPORT');
const viewport = await version();
assert.notEqual(viewport, render, `the Viewport stack leaves ${body.name}'s ${modifier.name} off`);
setExportEvaluation(world, 'RENDER');
assert.equal(await version(), render, 'the setting alone decides: Render again gives the same package');

// The Game area's switch: the scene's setting set, exported again and played fresh.
const game = createGameRun({ appModule, exportAgain: () => preview.reload(), engine: () => new core.NullEngine() });
let written;
const preview = createPackagePreview({ world, idle: (run) => run(), post: () => {},
  publish: async (made, tables) => {
    written?.remove();
    written = writePackage(made.files);
    await game.play(made, tables, new URL('./', written.url).href);
    return written.url;
  } });
await preview.reload();
const before = game.blend;
setExportEvaluation(world, 'VIEWPORT');
await preview.reload();
assert.ok(game.blend !== before && before.scene.isDisposed, 'switching loads the run fresh');
assert.equal(preview.state.version, viewport, 'the run plays what a full export with Viewport gives');
assert.equal(game.blend.version, viewport);

game.dispose();
written.remove();
console.log(`Export evaluation: Render by default; Viewport leaves ${modifier.name} off; the Game area's switch plays a full export's package`);
process.exit(0);
