// Milliseconds per frame of an exported rig in its page (Node, NullEngine): the scene exported as File > Export >
// JavaScript does, loaded, and played frame by frame, its rig posed by what the export chose (Blender's constraint
// kernels, the page's solvers, or samples). Prints one row per scene: its bones, the implementation, the page's time
// per frame (setting the frame, solving the pose, rendering) and the kernels' own time per evaluation.
// usage: node tools/benchmarks/rig-frames.mjs [example id or .blend path ...]   (default: rigged-character)
import { NullEngine } from '@babylonjs/core';
import { blendData } from '../../src/python/bpy_rna.js';
import { exportModule } from '../../src/io_scene_babylon/js-export.js';
import { openExample } from '../../tests/open-example.js';
import { writePackage } from '../../tests/export-package.js';

const FRAMES = 120, WARMUP = 10;
const scenes = process.argv.slice(2);
const name = scenes[0] ?? 'rigged-character';
const { world, sync } = openExample(name);
sync.view();
const files = await exportModule(world);
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const frame = blend.controls().find((c) => c.path.endsWith('.frame_current')).path;
const step = async (f) => { blend.set(frame, f); blend.scene.render(); await blend.settled(); };
for (let f = 1; f <= WARMUP; f++) await step(f);
const start = performance.now();
for (let f = 1; f <= FRAMES; f++) await step(1 + (f % 60));
const ms = (performance.now() - start) / FRAMES;
const bones = [...blendData().objects].filter((o) => o.type === 'ARMATURE').reduce((n, o) => n + o.data.bones.length, 0);
console.log(`${name.split(/[\/]/).pop()}: ${bones} bones, ${entity?.implementation ?? 'sampled'}, ${ms.toFixed(2)} ms per frame in the page`);
blend.dispose();
written.remove();
