---
id: sculpting
title: Sculpting
summary: Sculpt a mesh in Sculpt Mode with Blender's brushes, Grab, Draw, Crease, Inflate and Smooth, each stroke one undo step, here on a ceramic owl.
expect: Sculpt Mode, its brushes, their keys and strokes are Blender's code and move the mesh as Blender's do; dynamic topology and multiresolution sculpting are not set up in the steps.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/sculpting/introduction/index.html
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/sculpting/brushes/index.html
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/brush/index.html
  - https://docs.blender.org/manual/en/5.2/editors/3dview/modes.html
example: sculpting
thumbnail: sculpting/thumbnail.png
media:
  - sculpting/sculpt-mode.gif
  - sculpting/grab.gif
  - sculpting/draw.gif
  - sculpting/crease.gif
  - sculpting/inflate.gif
  - sculpting/smooth-undo.gif
ui:
  - VIEW_3D
  - SCULPT
  - VIEW3D_MT_sculpt
  - VIEW3D_PT_tools_brush_settings
  - VIEW3D_PT_tools_brush_falloff
  - VIEW3D_PT_tools_brush_stroke
operators:
  - object.mode_set
  - sculpt.brush_stroke
  - brush.asset_activate
  - ed.undo
code:
  - src/editors/object/main-modes.js
  - src/editors/space_view3d/view3d-window.js
tests:
  - tests/sculpt-wasm.test.js
limits:
  - The owl's starting form is made by its script with brush-like falloffs (grab, draw, inflate and crease around points and along lines), not by recorded strokes.
---
# Sculpting

Sculpt Mode shapes a mesh like clay: each brush moves the vertices under it, weighted by its falloff, as the pointer
drags. The mode, its brushes and strokes are Blender's code in the module: Draw raises (Ctrl lowers), Grab pulls a
region along, Crease cuts a sharp groove, Inflate swells along the normals, and holding Shift smooths with any brush.
Each stroke is one undo step, and Ctrl Z takes it back without leaving the mode.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=sculpting)

The demo, Ceramic Owl, is made in Blender by a script (`sculpting.py`): a quad sphere of about 10,000 faces shaped
into an owl with ear tufts, a face of two discs, eyes, a beak, wings and rows of feathers, glazed in celadon on a
walnut plinth. The steps sculpt on it further.

## Steps

1. **Sculpt Mode.** Select Owl, press Numpad 1 and Numpad . to frame its face, then pick Sculpt Mode in the 3D Viewport's mode menu. The Draw brush is active, its circle follows the pointer.

   ![Entering Sculpt Mode](../media/features/sculpting/sculpt-mode.gif)

2. **Grab.** G picks Grab. Drag from an ear tuft upward: the tuft and the region in the brush's circle follow.

   ![Grab pulling an ear tuft](../media/features/sculpting/grab.gif)

3. **Draw.** V picks Draw. A stroke over the eyes raises a brow; a stroke along a wing with Ctrl held cuts in.

   ![Draw, and Draw with Ctrl](../media/features/sculpting/draw.gif)

4. **Crease.** Shift C picks Crease Polish. A stroke down from between the eyes cuts a sharp line for the beak.

   ![Crease](../media/features/sculpting/crease.gif)

5. **Inflate.** I picks Inflate. A short stroke on a cheek swells it.

   ![Inflate on a cheek](../media/features/sculpting/inflate.gif)

6. **Smooth and undo.** Holding Shift smooths the forehead with whatever brush is active. Ctrl Z takes the last stroke back and
   stays in Sculpt Mode.

   ![Smooth, then Ctrl Z](../media/features/sculpting/smooth-undo.gif)

## Project files

- [sculpting.py](../../examples/sculpting/sculpting.py): builds the owl from a quad sphere, its glaze, the plinth,
  lights and camera, in Blender 5.2.
- [sculpting.blend](../../examples/sculpting/sculpting.blend): the file the script saves.
- [index.js](../../examples/sculpting/index.js): opens the .blend with Blender's reader.
- Recorded by [record-sculpting.mjs](../../tools/docs/record-sculpting.mjs).
