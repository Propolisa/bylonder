// Instancing hides objects as Blender does (main-api.cc object_instancing_hides): the Basic Character example's grass, instanced
// on a scatter mesh's faces with Show Instancer off. The viewport draws the tufts but not the scatter mesh, and shows
// the original tuft; a render hides the original too; File > Export > Babylon writes what a render shows, with the
// tufts as thin instances that cast shadows.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { serializeScene } from '../src/io_scene_babylon/babylon-export.js';

const { world, sync, node } = openExample('basic-character');
sync.view();
const scatter = node('Grass Scatter'), tuft = node('Grass Tuft');
assert.equal(scatter.isVisible, false, 'the scatter mesh, Show Instancer for Viewport off, is not drawn');
assert.equal(tuft.isVisible, true, 'the viewport shows the original tuft, as Blender does');
const carriers = world.scene.meshes.filter((m) => m.thinInstanceCount > 0 && m.metadata?.instancers?.includes(scatter));
assert.ok(carriers.length === 1 && carriers[0].thinInstanceCount > 100, 'the tufts are drawn as thin instances');

world.collections.useRenderVisibility(true);
assert.equal(tuft.isVisible, false, 'a render hides the original its parent instances on faces');
assert.equal(scatter.isVisible, false, 'and the scatter mesh, Show Instancer for Render off');
world.collections.useRenderVisibility(false);
assert.equal(tuft.isVisible, true, 'back in the viewport, the original shows again');

const json = await serializeScene(world);
const entry = (name) => json.meshes.find((m) => m.name === name);
assert.equal(entry('Grass Scatter')?.isVisible ?? false, false, 'the export hides the scatter mesh');
assert.equal(entry('Grass Tuft')?.isVisible ?? false, false, 'and the original tuft, as a render does');
assert.ok(json.meshes.some((m) => m.thinInstances?.instancesCount > 100 || m.name.includes('Grass Scatter Instances')), 'the tufts are exported as thin instances');
const casters = new Set((json.shadowGenerators ?? []).flatMap((g) => g.renderList ?? []));
assert.ok([...casters].some((name) => /Grass Scatter Instances/.test(name)), `the instanced tufts cast shadows: ${[...casters].join(', ')}`);
assert.equal(tuft.isVisible, true, 'the export leaves the view as it was');
console.log('instancing visibility: viewport, render and export as Blender');
process.exit(0);
