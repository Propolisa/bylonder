// A clip playing takes the bones it animates from the timeline: the Rigged Character's action runs in the page from the
// paused timeline (its F-Curves live) and plays as a clip too; played with blend.play, the clip's pose is what the page
// shows at each of its frames, as Main poses the action there, not the timeline's frame (before, the timeline's curves
// wrote the bones back every frame, the IK hands decimeters off).
import assert from 'node:assert/strict';
import { Matrix, NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const FRAMES = [12, 24, 40];
// The IK solver's tolerance, in metres.
const TOLERANCE = 2e-3;

const { world, sync } = openExample('rigged-character');
const rig = blendData().objects.get('Rig'), action = rig.animation_data.action;
sync.view();
const files = await exportModule(world, { animations: 'BOTH' });
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
const heads = FRAMES.map((f) => { sync.frameChanged(f); return new Map([...rig.pose.bones].map((pb) => [pb.name, babylonMatrix(Array.from(pb.matrix)).m.slice(12, 15)])); });

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const render = async () => { blend.scene.render(); await blend.settled(); };
blend.playhead.pause();
await render();
const clip = blend.play(action.name), start = clip.metadata.bylonder.frame_start;
clip.pause();
const skeleton = blend.scene.getSkeletonById(entity.inputs.skeleton), unspace = Matrix.Invert(Matrix.FromArray(entity.inputs.space));
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix);
for (const [n, f] of FRAMES.entries()) {
  clip.goToFrame(f - start);
  await render();
  await render();
  for (const bone of skeleton.bones) {
    const theirs = heads[n].get(bone.name);
    if (!theirs) continue;
    const ours = absolute(bone).multiply(unspace).m, error = Math.max(...[0, 1, 2].map((k) => Math.abs(ours[12 + k] - theirs[k])));
    assert.ok(error < TOLERANCE, `frame ${f}: ${bone.name} is ${(error * 1000).toFixed(1)} mm from Main`);
  }
}
blend.dispose();
written.remove();
console.log(`Export clip claims: a clip played over its own live timeline takes Main's pose at ${FRAMES.length} frames`);
process.exit(0);
