// Live Modifiers: a modifier limited to a vertex group deforms in the page as in the app (Koi Pond's Tail Swing, a
// Simple Deform on the Tail group): the page's mesh carries the object's vertex groups and attributes.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { blendData } from '../src/python/bpy_rna.js';

const { world, sync } = openExample('vertex-and-weight-paint');
sync.view();
const files = await exportModule(world, { live: true });
const modifier = JSON.parse(files['scene.ir.json']).entities['OB:Kohaku/modifier/Tail Swing'];
assert.deepEqual(modifier.inputs.mesh.vertex_groups?.map((g) => g.name), ['Tail'], 'the base mesh carries the vertex group');
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const owner = 'objects["Kohaku"].modifiers["Tail Swing"]', path = blend.controls().find((c) => c.path.startsWith(owner) && /\.(angle|factor)$/.test(c.path)).path;
const fish = world.objects.find((n) => n.name === 'Kohaku');
blend.set(path, 0.6);
blendData().path_resolve(owner)[path.split('.').pop()] = 0.6;
sync.view();
await Promise.all([blend.settled(), world.modifiers.settled?.()]);
const app = Array.from(fish.getVerticesData('position')), page = Array.from(blend.scene.getMeshById(fish.id).getVerticesData('position'));
assert.equal(page.length, app.length, 'vertex count');
const off = Math.max(...page.map((v, i) => Math.abs(v - app[i])));
assert.ok(off < 1e-4, `positions off by ${off}`);
blend.dispose();
written.remove();
console.log('Live modifiers: a modifier on a vertex group deforms in the page as in the app');
process.exit(0);
