// The exported page's one clock (runtime/playhead.js): it starts paused at the scene's frame, plays at the scene's
// frame rate through sub-frames (whole frames with snap), holds the last frame before looping or stops there, seeks,
// and sets every animation group to its frame but one kept on real time; a target with a time offset plays later.
import assert from 'node:assert/strict';
import { Animation, AnimationGroup, FreeCamera, NullEngine, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { createPlayhead } from '../src/io_scene_babylon/runtime/playhead.js';
import { readIR } from '../src/io_scene_babylon/runtime/ir.js';

const engine = new NullEngine(), scene = new Scene(engine);
// 16 ms a drawn frame: at 25 fps, 0.4 frames.
scene.useConstantAnimationDeltaTime = true;
new FreeCamera('Camera', Vector3.Zero(), scene);
/** A node whose x is the frame, from 1 to 10, played by a started, paused group. @param {string} name */
const keyed = (name) => {
  const node = new TransformNode(name, scene), animation = new Animation(name, 'position.x', 25, Animation.ANIMATIONTYPE_FLOAT);
  animation.setKeys([{ frame: 1, value: 1 }, { frame: 10, value: 10 }]);
  const group = new AnimationGroup(name, scene);
  group.addTargetedAnimation(animation, node);
  group.start(true).pause();
  return { node, group };
};
const held = keyed('Held'), real = keyed('Real');
const time = { frame_current: 3, frame_start: 1, frame_end: 10, fps: 50, fps_base: 2, loop: true };
const playhead = createPlayhead(scene, time);
const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a}, not ${b}`);

assert.equal(playhead.fps, 25, 'fps / fps_base');
assert.equal(playhead.playing, false);
near(held.node.position.x, 3, 'set to the scene frame at once');
scene.render();
near(playhead.frame, 3, 'paused, it stays');

/** @type {import('../src/io_scene_babylon/runtime/playhead.js').PlayheadState[]} */
const told = [];
playhead.onChanged.add((state) => told.push(state));
playhead.play();
scene.render();
near(playhead.frame, 3.4, 'a sub-frame each drawn frame');
near(held.node.position.x, 3.4, 'the group follows');
assert.deepEqual(told.map((s) => s.playing), [true, true]);

playhead.snap = true;
scene.render();
assert.equal(playhead.frame, 3, 'with snap, whole frames as Blender shows them');
playhead.snap = false;

playhead.seek(9.9);
scene.render();
assert.equal(playhead.frame, 10, 'the last frame holds for a whole frame');
scene.render();
scene.render();
near(playhead.frame, 1.1, 'then loops to the first');

playhead.keepRealTime(real.group);
assert.ok(real.group.isPlaying, 'kept on real time, it plays on its own');
const realAt = real.node.position.x;
playhead.seek(7);
near(held.node.position.x, 7, 'a seek moves what follows');
assert.equal(real.node.position.x, realAt, 'and not what keeps real time');
playhead.keepRealTime(real.group, false);
near(real.node.position.x, 7, 'back on the playhead, at its frame');

playhead.pause();
assert.equal(told.at(-1)?.playing, false);
playhead.seek(5);
scene.render();
near(held.node.position.x, 5, 'a seek while paused sets the frame');

// A target offset by two frames (a collection's Time Offset) shows its animation two frames later, wrapped into the range.
playhead.offsetOf = (target) => (target === held.node ? 2 : 0);
playhead.refresh();
near(held.node.position.x, 3, 'offset by 2, frame 5 shows its frame 3');
near(real.node.position.x, 5, 'what is not offset stays at the frame');
playhead.seek(2);
near(held.node.position.x, 10, 'before the start, it wraps to the end');
assert.equal(playhead.frameAt(2), 10, 'frameAt gives the frame an offset shows');
playhead.offsetOf = () => 0;
playhead.refresh();

const once = createPlayhead(scene, { ...time, frame_current: 9, loop: false });
once.play();
for (let i = 0; i < 6; i++) scene.render();
assert.equal(once.frame, 10, 'without loop it stops at the end');
assert.equal(once.playing, false);
once.play();
near(once.frame, 1, 'and plays again from the start');
once.dispose();
playhead.dispose();

assert.deepEqual(readIR({ schema: 'bylonder-ir', version: 1 }).scene.time, { frame_current: 1, frame_start: 1, frame_end: 250, fps: 24, fps_base: 1, loop: true, sample_rates: {}, clips: {}, markers: [], sounds: [] },
  "an IR without the scene's time reads Blender's defaults");
scene.dispose();
engine.dispose();
console.log('Playhead: one clock at the scene frame rate, sub-frames or whole frames, loops or stops, seeks, offsets targets, and leaves what keeps real time');
