---
id: keyframe-animation
title: Keyframe Animation
summary: Key an object's rotation with I at two frames, shape the motion between them with an F-curve's interpolation and easing in the Graph Editor, and play it.
expect: Keying with I, the Timeline, the Graph Editor's interpolation and easing modes and playback work as in Blender, evaluated by Blender's animation code; the Graph Editor's Frame All does not frame the curves yet.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/animation/keyframes/introduction.html
  - https://docs.blender.org/manual/en/5.2/animation/keyframes/editing.html
  - https://docs.blender.org/manual/en/5.2/editors/graph_editor/fcurves/properties.html
  - https://docs.blender.org/manual/en/5.2/editors/timeline.html
example: newtons-cradle
thumbnail: keyframe-animation/thumbnail.png
media:
  - keyframe-animation/pendulum.gif
  - keyframe-animation/key-swing.gif
  - keyframe-animation/ease.gif
  - keyframe-animation/play.gif
  - keyframe-animation/cradle.gif
ui:
  - VIEW_3D
  - TIMELINE
  - FCURVES
  - TIME_*
  - DOPESHEET_MT_marker
  - ANIM_MT_keyframe*
  - VIEW3D_MT_object_animation
  - GRAPH_MT_key
operators:
  - anim.keyframe_insert
  - transform.rotate
  - object.rotation_clear
  - object.editmode_toggle
  - transform.translate
  - graph.interpolation_type
  - graph.easing_type
  - graph.view_all
  - view2d.pan
  - view2d.zoom
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
  - The Graph Editor's View > Frame All (Home) and Frame Selected (Numpad .) do nothing: pan with a middle drag and zoom with Ctrl middle drag instead.
---
# Keyframe Animation

A keyframe stores a property's value at a frame; between keys Blender interpolates along an F-curve. Hovering the 3D
Viewport and pressing I keys the selected objects' location, rotation and scale at the current frame. How the value
travels between two keys is the F-curve's interpolation (Constant, Linear, Bezier or an easing curve such as Sine) and
its easing (In, Out or both), set in the Graph Editor. Keys are Blender's actions in the module (`anim-api.cc`),
evaluated by Blender's code.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=newtons-cradle)

The demo is a Newton's cradle. Each pendulum is an empty with a ball and two threads parented to it, so one keyed
rotation swings the whole pendulum. The outer pendulums are keyed with Sine interpolation: Ease In on the way down, so
a ball falls faster and faster into the row, and Ease Out on the way up, so it slows to a stop at the top of its swing.
Between the two the right ball holds still at 0 degrees.

## Steps

1. **A pendulum.** In a new file, hover the 3D Viewport and press Delete to remove the cube. Shift A > Mesh > UV Sphere
   adds the ball and G Z 2.5 Enter raises it. Tab, G Z -2 Enter and Tab again move the ball's mesh down in Edit Mode,
   so its origin, the point it turns about, stays 2 m above it.

   ![A ball hanging 2 m below its origin](../media/features/keyframe-animation/pendulum.gif)

2. **Key the swing.** Press R Y 40 Enter to raise the ball, then I to key the rotation at
   frame 1. Type 16 in the Timeline's current frame field, press Alt R to bring the ball back down and I again.

   ![R Y 40 and I at frame 1, Alt R and I at frame 16](../media/features/keyframe-animation/key-swing.gif)

3. **Ease the fall.** Switch the Timeline to the Graph Editor with its Editor Type menu and drag its top edge up.
   Normalize in the header scales each curve to -1 to 1. Middle drag over the curves to bring the keys to the middle,
   then Ctrl middle drag to the right to stretch time. A selects every key. Key > Interpolation Mode (T) > Sinusoidal,
   then Key > Easing Mode (Ctrl E) > Ease In: the curve starts flat and ends steep, so the ball gains speed as it falls.

   ![T > Sinusoidal and Ctrl E > Ease In in the Graph Editor](../media/features/keyframe-animation/ease.gif)

4. **Play.** Go back to frame 1 and press Space; Space again stops. The playhead runs along the curve.

   ![Space plays the fall](../media/features/keyframe-animation/play.gif)

5. **The cradle.** The example keys two pendulums this way over a 60 frame cycle. Its brass balls mix two Glossy BSDFs
   (a sharp and a rough lobe), a warm spot light and a cool rim light cast soft shadows on the walnut base, and the
   scene camera frames it in Rendered shading.

   ![The Newton's Cradle example playing in Rendered shading](../media/features/keyframe-animation/cradle.gif)

## Project files

- [newtons-cradle.py](../../examples/newtons-cradle/newtons-cradle.py): builds the cradle, its materials, lights and
  camera, and keys the two outer pendulums with Sine easing, in Blender 5.2.
- [newtons-cradle.blend](../../examples/newtons-cradle/newtons-cradle.blend): the file the script saves.
- [index.js](../../examples/newtons-cradle/index.js): opens the .blend with Blender's reader.
- Recorded by [record-keyframe-animation.mjs](../../tools/docs/record-keyframe-animation.mjs).
