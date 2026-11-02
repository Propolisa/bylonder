---
id: nla
title: Nonlinear Animation
summary: Layer and mix actions as strips on tracks in Blender's Nonlinear Animation editor, with push down, tweak mode, strip blending, influence and repeats, evaluated by Blender's animation system.
expect: Tracks, strips, push down, tweak mode and strip blending run Blender's code and evaluate as in Blender; sound strips and control curves are listed but not checked against Blender's drawing.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/nla/index.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/introduction.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/tracks.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/strips.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/sidebar.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/tweaking.html
example: nla
thumbnail: nla/thumbnail.png
media:
  - nla/open.gif
  - nla/select.gif
  - nla/tweak.gif
  - nla/play.gif
ui:
  - NLA_EDITOR
  - NLA_*
operators:
  - nla.click_select
  - nla.select_box
  - nla.select_all
  - nla.action_pushdown
  - nla.tweakmode_enter
  - nla.tweakmode_exit
  - nla.actionclip_add
  - nla.transition_add
  - nla.tracks_add
  - nla.tracks_delete
  - nla.split
  - nla.duplicate_move
  - nla.delete
  - nla.mute_toggle
  - nla.meta_add
  - nla.move_up
  - nla.move_down
  - nla.fmodifier_add
  - transform.translate
  - screen.animation_play
code:
  - src/editors/animation/anim-editor.js
  - src/editors/animation/anim-area.js
  - src/editors/interface/region-draw.js
  - tools/blender-port/wasm/region-draw.cc
  - tools/blender-port/wasm/anim-api.cc
tests:
  - tests/nla-wasm.test.js
limits:
  - Strips of sound clips and NLA control curves are listed but their sounds and curves are not checked against Blender's drawing.
  - Keyframe shapes on the action line are drawn without their extreme markers (the Dope Sheet's up and down arrows).
---
# Nonlinear Animation

The Nonlinear Animation editor (NLA) is Blender's editor for layering actions. Each animated data-block has tracks of
strips; a strip plays an action over a frame range, repeated, scaled, blended in or out, and mixed with the tracks
below it by its blending mode and influence. The editor is Blender's own, run in the module: its space and regions,
its keymaps and operators (selection, push down, tweak mode, transform, split, duplicate, meta strips, transitions),
the channel list and the main region's strips drawn by Blender's draw code, and the sidebar's strip panels. Blender's
animation system evaluates the strips each frame (the action under the tracks, then each track's strips), so the scene
plays exactly as in Blender.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=nla)

The demo is a box animated by three actions made in Blender by a script (`nla.py`): Slide moves it across the ground,
Hop repeats a hop three times added on top, and Turn combines a quarter turn at half influence from frame 49.

## Steps

1. **Open the editor.** Click the Timeline's Editor Type menu and pick Nonlinear Animation, then drag the border above
   it up. Box lists its action line (`<No Action>`) and the tracks Turn, Hop and Slide with their strips.

   ![The Timeline switched to the Nonlinear Animation editor](../media/features/nla/open.gif)

2. **A strip's properties.** Click the Hop strip: the sidebar (N shows or hides it) has its Strip tab, with its frames,
   extrapolation, blending (Add), blend in and out, influence, and its action clip's repeat and playback scale.

   ![Selecting a strip and its sidebar](../media/features/nla/select.gif)

3. **Tweak mode.** Press Tab to edit the strip's action in place: the other tracks dim and the Dope Sheet and Graph
   Editor show Hop's keys. Tab again leaves tweak mode.

   ![Tab into tweak mode and out](../media/features/nla/tweak.gif)

4. **Play it.** Press Space: Blender evaluates the stack each frame, so the box slides, hops three times and turns.

   ![Playing the layered animation](../media/features/nla/play.gif)

5. **Push down.** Key any property (I over the 3D Viewport): the keys make an action on the action line, its keys
   drawn as keyframe shapes. The button beside it (Push Down) moves the action into a new strip, ready to be layered.

## Project files

- [nla.py](../../examples/nla/nla.py): builds the box, its three actions and their tracks and strips, in Blender 5.2.
- [nla.blend](../../examples/nla/nla.blend): the file the script saves.
- [index.js](../../examples/nla/index.js): opens the .blend with Blender's reader.
- Recorded by [record-nla.mjs](../../tools/docs/record-nla.mjs).
