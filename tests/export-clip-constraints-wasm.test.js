// A clip of a rig whose constraints run in the page keys each bone's own location, rotation and scale, which the page's
// solver poses from: the Rigged Character's IK rig (on Blender's kernels) playing its action as a clip takes Main's
// pose at frames of it, its constraints applied once. Before, clips keyed the evaluated pose, which the solver then
// constrained again (the arms off by decimeters). Its action is in a muted NLA strip, so the clip alone moves the rig.
import assert from 'node:assert/strict';
import { Matrix, NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const FRAMES = [1, 12, 24, 40];
// The IK solver's tolerance, in metres.
const TOLERANCE = 2e-3;

const { world, sync } = openExample('rigged-character');
const rig = blendData().objects.get('Rig'), animation = rig.animation_data, action = animation.action;
const track = animation.nla_tracks.new();
track.strips.new(action.name, Math.round(action.frame_range[0]), action);
track.mute = true;
animation.action = null;
sync.view();
const files = await exportModule(world, { animations: 'BOTH' });
const entity = Object.values(JSON.parse(files['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
assert.equal(entity?.implementation, 'pose-kernels', 'the rig constraints run in the page');

// Main's pose with the action playing.
animation.action = action;
animation.action_slot = [...action.slots][0];
sync.view();
const heads = FRAMES.map((f) => { sync.frameChanged(f); return new Map([...rig.pose.bones].map((pb) => [pb.name, babylonMatrix(Array.from(pb.matrix)).m.slice(12, 15)])); });

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
const render = async () => { blend.scene.render(); await blend.settled(); };
await render();
const clip = blend.scene.animationGroups.find((g) => g.name === action.name), start = clip.metadata.bylonder.frame_start;
clip.start(true);
clip.pause();
const skeleton = blend.scene.getSkeletonById(entity.inputs.skeleton), unspace = Matrix.Invert(Matrix.FromArray(entity.inputs.space));
const absolute = (bone) => (bone.getParent() ? bone._matrix.multiply(absolute(bone.getParent())) : bone._matrix);
for (const [n, f] of FRAMES.entries()) {
  clip.goToFrame(f - start);
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
console.log(`Export clip constraints: a constrained rig's clip takes Main's pose at ${FRAMES.length} frames, its constraints solved once in the page`);
process.exit(0);
