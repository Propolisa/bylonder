// The JavaScript export's object constraints against Blender's: the NLA example's Ground given a constraint on the
// animated Box (Copy Location of x and y, Track To, Copy Rotation, Child Of), exported and loaded, follows the box as
// Main evaluates it at frames of the range, the constraint applied in the page (not a sample per frame).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const CASES = {
  COPY_LOCATION: (c) => { c.use_z = false; },
  TRACK_TO: (c) => { c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'; },
  COPY_ROTATION: () => {},
  // An inverse of a turn about Z and a move, as Set Inverse leaves one.
  CHILD_OF: (c) => { c.inverse_matrix = [Math.cos(0.5), Math.sin(0.5), 0, 0, -Math.sin(0.5), Math.cos(0.5), 0, 0, 0, 0, 1, 0, 1, 2, 0.5, 1]; },
};
const FRAMES = [1, 20, 49, 60, 96];

async function check(type) {
  const { world, sync } = openExample('nla');
  const box = blendData().objects.get('Box'), ground = blendData().objects.get('Ground');
  const constraint = ground.constraints.new(type);
  constraint.target = box;
  CASES[type](constraint);
  sync.view();
  const files = await exportModule(world);
  const ir = JSON.parse(files['scene.ir.json']);
  assert.ok(Object.values(ir.entities).some((e) => e.type === 'constraints:OBJECT' && e.implementation === 'constraints'), `${type}: the page applies it`);
  const groups = JSON.parse(/const ANIMATION_GROUPS = (.*);\n/.exec(files['scene.js'])[1]);
  assert.ok(!groups.some((g) => g.targetedAnimations.some((t) => t.targetId === 'Ground')), `${type}: the Ground is not sampled`);
  const written = writePackage(files);
  const blend = await (await import(written.url)).load(new NullEngine());
  await blend.settled();
  const page = blend.scene, frameControl = blend.controls().find((c) => c.path.endsWith('.frame_current'));
  blend.playhead.pause();
  for (const frame of FRAMES) {
    blend.set(frameControl.path, frame);
    page.render();
    await blend.settled();
    page.render();
    sync.frameChanged(frame);
    const drawn = page.getNodeById('Ground').computeWorldMatrix(true).asArray(), main = babylonMatrix(sync.blender.transform(sync.objectOf(world.scene.getNodeById('Ground'))).matrix_world).asArray();
    assert.ok(drawn.every((v, i) => Math.abs(v - main[i]) < 1e-4), `${type} at frame ${frame}: ${drawn.map((v) => v.toFixed(3))}, Main ${main.map((v) => v.toFixed(3))}`);
  }
  console.log(`${type}: the Ground follows the Box as Main evaluates it at ${FRAMES.length} frames`);
  blend.dispose();
  written.remove();
}

const [type] = process.argv.slice(2);
if (type) await check(type);
else {
  for (const name of Object.keys(CASES)) process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).split('\n').filter((l) => !l.startsWith('BJS')).join('\n'));
  console.log('Export constraints: Copy Location, Track To, Copy Rotation and Child Of run in the page as Main evaluates them');
}
