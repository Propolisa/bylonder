// A World of several Background nodes draws the one its World Output's Surface links, as Blender does, in the app
// (whose World properties show that node, the one Main holds its values in) and the exported page, whose world
// controls name that node. The scene is tests/fixtures/world-drawn-background.blend,
// written by tools/blender-reference/world-drawn-background-fixture.py.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const DRAWN = [0.1, 0.2, 0.4], STRENGTH = 2;
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
const { world, scene, sync } = openExample(new URL('./fixtures/world-drawn-background.blend', import.meta.url));
sync.view();
const { color, strength } = scene.metadata.wbWorld;
assert.ok(near(color, DRAWN) && strength === STRENGTH, `the app draws the linked Background: ${color} x ${strength}`);
const surface = createRNA({ world }).pointer('World', world.worlds.active()).node_tree.get_output_node().inputs[0].links[0].from_node;
assert.equal(surface.name, 'Background.001', 'World properties show the linked Background');
assert.deepEqual(sync.check().filter((diff) => diff.startsWith('World')), [], "whose values are that node's in Main");

const blend = await (await import(writePackage(await exportModule(world)).url)).load(new NullEngine());
const base = 'worlds["World"].node_tree.nodes["Background.001"].inputs';
assert.ok(near([0, 1, 2].map((i) => blend.get(`${base}[0].default_value[${i}]`)), DRAWN), "the page's world controls are the linked Background's");
assert.equal(blend.get(`${base}[1].default_value`), STRENGTH);
assert.ok(near(blend.scene.environmentTexture.clearColor.asArray().slice(0, 3), DRAWN.map((v) => v * STRENGTH)), 'and light the page');
console.log('World: the Background its output links draws, in the app and the page');
