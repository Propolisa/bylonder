---
id: nla
title: Nonlinear Animation
summary: Layer and mix actions as strips on tracks in Blender's Nonlinear Animation editor, with push down, tweak mode, strip blending, influence and repeats, evaluated by Blender's animation system.
expect: Tracks, strips, tweak mode and strip blending run Blender's code and evaluate as in Blender; the action line has no Push Down button, and sound strips and control curves are listed but not checked against Blender's drawing.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/nla/index.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/introduction.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/tracks.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/strips.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/sidebar.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/tweaking.html
example: carousel
thumbnail: nla/thumbnail.png
media:
  - nla/hop.gif
  - nla/carousel.gif
  - nla/strips.png
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
  - object.location_clear
  - nla.view_all
  - anim.keyframe_insert
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
  - The action line has no Push Down button; an action becomes a strip from Python (`nla_tracks.new`, `strips.new`).
  - Strips of sound clips and NLA control curves are listed but their sounds and curves are not checked against Blender's drawing.
  - Keyframe shapes on the action line are drawn without their extreme markers (the Dope Sheet's up and down arrows).
---
# Nonlinear Animation

The Nonlinear Animation editor (NLA) is Blender's editor for layering actions. Each animated data-block has tracks of
strips; a strip plays an action over a frame range, repeated, scaled, blended in or out, and mixed with the tracks
below it by its blending mode and influence. One action can be placed as strips on many objects, each starting at its
own frame, so a single cycle animates a crowd out of step. The editor is Blender's own, run in the module: its space
and regions, its keymaps and operators (selection, push down, tweak mode, transform, split, duplicate, meta strips,
transitions), the channel list and the main region's strips drawn by Blender's draw code, and the sidebar's strip
panels. Blender's animation system evaluates the strips each frame (the action under the tracks, then each track's
strips), so the scene plays exactly as in Blender.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=carousel)

The demo is a carousel at dusk. Its six swans share two actions of one 24 frame cycle each: Gallop moves a swan up its
pole and back, Rock pitches it. Each swan has a Gallop track and a Rock track (blended with Add), both repeated six
times, and each swan's strips start a quarter cycle after the previous swan's, so the riders rise and fall as a wave.
The platform turns by an action of its own with linear extrapolation. Warm point and spot lights under the canopy and
from the front, a cool moon and emissive bulbs light the scene.

## Steps

1. **Key a cycle.** In a new file, hover the 3D Viewport and press I to key the cube at frame 1. At frame 7 press G Z 1
   Enter and I; at frame 13 press Alt G and I. The keys make an action, CubeAction: one hop, the kind of cycle the
   example's Gallop and Rock are.

   ![Keys at frames 1, 7 and 13](../media/features/nla/hop.gif)

2. **Strips of one cycle.** The example's script places Gallop and Rock as strips on six swans (`nla_tracks.new`,
   `strips.new`), each repeated six times and each swan's a quarter cycle later. Play it in Rendered shading.

   ![The Carousel example playing](../media/features/nla/carousel.gif)

3. **Read the strips.** Switch the Timeline to Nonlinear Animation with its Editor Type menu and drag its top edge up.
   With every object selected (A over the 3D Viewport), Home over the editor shows each swan's Rock and Gallop tracks,
   each pair starting later than the one above. Spin, the platform's action, is on its action line. Click a strip and
   press G to move it in time, or Tab to edit its action in place.

   ![The swans' staggered strips](../media/features/nla/strips.png)

## Project files

- [carousel.py](../../examples/carousel/carousel.py): builds the carousel, its materials and lights, the Gallop, Rock
  and Spin actions and every swan's tracks and strips, in Blender 5.2.
- [carousel.blend](../../examples/carousel/carousel.blend): the file the script saves.
- [index.js](../../examples/carousel/index.js): opens the .blend with Blender's reader.
- Recorded by [record-nla.mjs](../../tools/docs/record-nla.mjs).
