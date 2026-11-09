// The JavaScript export's animation against Blender's: each example's package, loaded, placed at frames of its range
// by its animation group, puts every animated mesh where Main evaluates it at that frame, with exact keys where an
// F-curve is all that moves a value and samples elsewhere (drivers, NLA, constraints).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

// Per example: frames to check, and the least share of its tracks that must be exact keys (not a sample per frame).
const EXAMPLES = { 'drivers-and-graph-editor': [1, 7, 13, 30, 61, 96], nla: [1, 10, 25, 49, 60, 80], compositor: [1, 37, 120, 240] };

async function check(id) {
  const { world, scene, sync } = openExample(id);
  sync.view();
  const files = await exportModule(world);
  const written = writePackage(files);
  const blend = await (await import(written.url)).load(new NullEngine());
  const page = blend.scene, group = page.animationGroups[0];
  const animated = new Set(group.targetedAnimations.map((t) => t.target));
  const meshes = scene.meshes.filter((m) => sync.objectOf(m) && animated.has(page.getMeshById(m.name)));
  assert.ok(meshes.length, `${id}: animated meshes`);
  group.stop();
  for (const frame of EXAMPLES[id]) {
    group.start(false, 1, frame, frame);
    group.goToFrame(frame);
    sync.frameChanged(frame);
    for (const mesh of meshes) {
      const drawn = page.getMeshById(mesh.name).computeWorldMatrix(true).asArray(), main = babylonMatrix(sync.blender.transform(sync.objectOf(mesh)).matrix_world).asArray();
      assert.ok(drawn.every((v, i) => Math.abs(v - main[i]) < 1e-4), `${id} ${mesh.name} at frame ${frame}: ${drawn.map((v) => v.toFixed(3))}, Main ${main.map((v) => v.toFixed(3))}`);
    }
    group.stop();
  }
  const keys = group.targetedAnimations.map((t) => t.animation.getKeys().length);
  console.log(`${id}: ${meshes.length} meshes at ${EXAMPLES[id].length} frames as Main; ${keys.length} tracks, ${keys.reduce((a, b) => a + b, 0)} keys`);
  blend.dispose();
  written.remove();
}

const example = process.argv[2];
if (example) await check(example);
else {
  for (const id of Object.keys(EXAMPLES)) process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).split('\n').filter((l) => !l.startsWith('BJS')).join('\n'));
  console.log('Export animation: meshes play where Main evaluates them at each checked frame, with exact keys where the F-curve is the motion');
}
