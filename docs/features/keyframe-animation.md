---
id: keyframe-animation
title: Keyframe Animation
summary: Key an object's transform with I at two frames on the Timeline and play the animation with Space.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/animation/keyframes/introduction.html
  - https://docs.blender.org/manual/en/5.2/animation/keyframes/editing.html
  - https://docs.blender.org/manual/en/5.2/editors/timeline.html
example: animation
thumbnail: keyframe-animation/thumbnail.png
media:
  - keyframe-animation/insert.gif
  - keyframe-animation/second-key.gif
  - keyframe-animation/play.gif
  - keyframe-animation/timeline.png
ui:
  - VIEW_3D
  - TIMELINE
  - TIME_MT_view
  - DOPESHEET_MT_marker
operators:
  - anim.keyframe_insert
  - transform.translate
  - transform.rotate
  - screen.animation_play
  - screen.frame_jump
  - screen.keyframe_jump
code:
  - src/blenkernel/animation/model.js
  - src/blenkernel/animation/anim-blender.js
  - src/blenkernel/animation/bindings.js
  - tools/blender-port/wasm/anim-api.cc
tests:
  - tests/animation.test.js
  - tests/anim-wasm.test.js
  - tests/animatable.test.js
limits:
  - The Keyframe Animation example keys a Babylon scene from code with the project SDK; the steps here key Blender's objects with I.
---
# Keyframe Animation

A keyframe stores a property's value at a frame; between keys Blender interpolates along F-curves. Hovering the 3D
Viewport and pressing I keys the selected objects' location, rotation and scale at the current frame. The Timeline
shows the keys as diamonds, plays the range and jumps between keys. Keys are Blender's actions in the module
(`anim-api.cc`), evaluated by Blender's code.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=animation)

The demo, Keyframe Animation, is a bouncing ball whose position, squash and color are keyed from code. The steps
below animate the Default Cube by hand.

## Steps

1. **Insert a key.** Select the cube, hover the 3D Viewport and press I. A diamond appears on the Timeline at frame 1
   and the keyed fields in Properties show a key in their decorator.

   ![I keys the cube at frame 1](../media/features/keyframe-animation/insert.gif)

2. **Key a second pose.** Type 40 in the Timeline's current frame field. Press G, X, 4, Enter to move the cube, then
   R, Z, 90, Enter to turn it, and press I again.

   ![Frame 40: move, rotate, I](../media/features/keyframe-animation/second-key.gif)

3. **Play.** Go back to frame 1 and press Space; Space again stops. The cube moves and turns between the keys with
   Blender's default Bezier easing.

   ![Space plays frames 1 to 40](../media/features/keyframe-animation/play.gif)

4. **Edit the keys.** On the Timeline, drag a diamond to retime it; Up and Down arrows jump between keys. View > Show
   Channels lists every F-curve.

   ![The keys at frames 1 and 40 on the Timeline](../media/features/keyframe-animation/timeline.png)

## Project files

- [index.js](../../examples/animation/index.js): the ball, its tracks and the keys made with `animation.insert` the
  first time the project runs.
- Recorded by [record-keyframe-animation.mjs](../../tools/docs/record-keyframe-animation.mjs).
