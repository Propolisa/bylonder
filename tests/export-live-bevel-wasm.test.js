// Live Modifiers: a Bevel's width set in the page bevels as the app does (Newton's Cradle's base). Its `width_pct` is
// the same DNA field in percent, not a control of its own that writes the old width back.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { blendData } from '../src/python/bpy_rna.js';

const { world, sync } = openExample('newtons-cradle');
sync.view();
const written = writePackage(await exportModule(world, { live: true }));
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const path = 'objects["Base"].modifiers["Bevel"].width', base = world.objects.find((n) => n.name === 'Base');
assert.ok(blend.controls().some((c) => c.path === path), `${path} is a control`);
assert.ok(!blend.controls().some((c) => c.path.endsWith('.width_pct')), 'width_pct is not a control of its own');
blend.set(path, 0.145);
blendData().path_resolve('objects["Base"].modifiers["Bevel"]').width = 0.145;
sync.view();
await Promise.all([blend.settled(), world.modifiers.settled?.()]);
const app = Array.from(base.getVerticesData('position')), page = Array.from(blend.scene.getMeshById(base.id).getVerticesData('position'));
assert.equal(page.length, app.length, 'vertex count');
const off = Math.max(...page.map((v, i) => Math.abs(v - app[i])));
assert.ok(off < 1e-4, `positions off by ${off}`);
blend.dispose();
written.remove();
console.log("Live modifiers: a Bevel's width set in the page bevels as in the app");
process.exit(0);
