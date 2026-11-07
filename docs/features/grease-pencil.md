---
id: grease-pencil
title: Grease Pencil
summary: Draw and animate 2D strokes in the 3D Viewport with Blender's Grease Pencil, its brushes, modes, layers and onion skins, drawn by Babylon's GreasedLine.
expect: Drawing, editing, layers and animation run Blender's code; stroke ends are flat, some blend modes, masks, gradient and texture fills and shader effects draw differently.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/grease_pencil/index.html
  - https://docs.blender.org/manual/en/5.2/grease_pencil/modes/draw/index.html
  - https://docs.blender.org/manual/en/5.2/grease_pencil/modes/edit/index.html
  - https://docs.blender.org/manual/en/5.2/grease_pencil/properties/layers.html
  - https://docs.blender.org/manual/en/5.2/grease_pencil/modes/draw/tools/fill.html
example: grease-pencil
thumbnail: grease-pencil/thumbnail.png
media:
  - grease-pencil/play.gif
  - grease-pencil/draw.gif
  - grease-pencil/fill.gif
  - grease-pencil/edit.gif
  - grease-pencil/layers.png
ui:
  - VIEW_3D
  - PAINT_GREASE_PENCIL
  - EDIT
  - SCULPT_GREASE_PENCIL
  - WEIGHT_GREASE_PENCIL
  - VERTEX_GREASE_PENCIL
  - PROPERTIES
  - VIEW3D_MT_paint_grease_pencil
  - VIEW3D_MT_edit_greasepencil*
  - VIEW3D_MT_greasepencil*
  - VIEW3D_MT_grease_pencil*
  - VIEW3D_MT_weight_grease_pencil
  - VIEW3D_MT_paint_vertex_grease_pencil
  - VIEW3D_PT_greasepencil*
  - VIEW3D_PT_grease_pencil*
  - VIEW3D_PT_tools_grease_pencil*
  - DATA_PT_grease_pencil*
  - GREASE_PENCIL_MT*
  - MATERIAL_PT_gpencil*
  - TOPBAR_PT_grease_pencil*
  - TOPBAR_PT_gpencil*
operators:
  - object.grease_pencil_add
  - object.mode_set
  - grease_pencil.brush_stroke
  - grease_pencil.fill
  - grease_pencil.select_all
  - grease_pencil.stroke_subdivide
  - grease_pencil.interpolate_sequence
code:
  - tools/blender-port/wasm/grease-pencil-api.cc
  - tools/blender-port/wasm/grease-pencil-render.cc
  - src/draw/grease-pencil.js
  - src/draw/grease-pencil-render.js
  - src/runtimes/grease-pencil.js
  - src/editors/object/main-modes.js
tests:
  - tests/grease-pencil-wasm.test.js
  - tests/e2e/smoke.mjs
limits:
  - Stroke ends and corners are flat (GreasedLine has no round caps or joins); Dots and Squares strokes draw as lines.
  - A layer's opacity applies per stroke; Hard Light and Divide layers blend as Regular; layer masks do not mask.
  - Gradient and texture fills draw in their fill color, texture strokes in their stroke color; strokes are not lit.
  - Fills draw under their layer's strokes rather than interleaved stroke by stroke.
  - Shader effects (Blur, Shadow, Rim, ...) and Line Art's evaluation in a render are not drawn.
  - Line Art objects are added and evaluated in the module but are not checked against Blender's.
  - The paint cursor (the brush circle) and Bezier handles in Edit Mode are not drawn.
  - Drawing a stroke through the camera (Numpad 0), as in Dusk Lake, hides the whole object until it is reopened; draw in a perspective view instead.
  - Fill does not yet fill a shape drawn in a new 2D Animation file in the viewport.
  - Properties > Data does not open on Dusk Lake (a page error); the Outliner and the Dope Sheet list its layers.
---
# Grease Pencil

Grease Pencil is Blender's 2D drawing and animation object: strokes of points with a radius, opacity and color, in
layers whose keyframes hold drawings, filled where the strokes close a shape. Everything about the data is Blender's
code in the module: the GreasePencil ID, its layers and frames, the brushes of Draw, Sculpt, Weight Paint and Vertex
Paint Modes, Edit Mode's operators, the modifiers, interpolation, onion skins and the .blend file. Babylon draws it:
each visible drawing's strokes are a GreasedLine mesh of their points' radii and colors, its fills a mesh of Blender's
fill triangles, and a stroke being drawn updates only a small mesh of the drawing's last strokes.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=grease-pencil)

The demo, Dusk Lake, is a 2D diorama: each layer is a flat drawing of fills and strokes (sky, sun, mountains, hills,
the lake, a boat, a pine shore, birds and reeds) placed at its own depth in front of the camera. The camera slides
sideways over 120 frames, so near layers pass faster than far ones (parallax); the boat, the birds and the reeds are
drawn on twos. It is made in Blender by a script (`grease-pencil.py`). File > New > 2D Animation opens Blender's own 2D Animation
template with its 2D Animation and 2D Full Canvas workspaces, in Draw Mode.

## Steps

1. **Play it.** Hover the 3D Viewport, press Numpad 0 to look through the camera, pick Rendered shading and press
   Space to play. The layers move at the speeds their depths give; the Timeline shows each layer's keys.

   ![Playing Dusk Lake through the camera](../media/features/grease-pencil/play.gif)

2. **Draw.** Open File > New > 2D Animation: its Stroke object is in Draw Mode. The tool header holds the
   brush, its material, radius and strength, the asset shelf Blender's brushes (Pencil, Ink Pen, Marker, Airbrush,
   Tint, Erasers, Fill). Drag to draw on the active layer, with a pen's pressure; onion skins show the frames before
   and after.

   ![Draw Mode and a stroke](../media/features/grease-pencil/draw.gif)

3. **Fill.** Draw a closed shape, pick Fill in the brush menu or the asset shelf, and click inside it. Blender's fill
   renders the strokes around the click (on Babylon) and traces the area they close; Gap Closure and Dilate are in
   the tool header.

   ![Three strokes and a fill](../media/features/grease-pencil/fill.gif)

4. **Edit.** Switch to Edit Mode: the points show, A selects them all and G moves them. The Grease Pencil, Point and
   Stroke menus hold Blender's operators (Subdivide, Simplify, Set Curve Type, Join, Extrude, Interpolate Sequence).

   ![Edit Mode: select all and move](../media/features/grease-pencil/edit.gif)

5. **Layers.** In Dusk Lake, the Outliner lists the object's layers under its data, from Reeds in front to Sky
   at the back. In Blender, Properties > Data lists them with their opacity, blend mode, onion skinning and masks.

   ![The Outliner: Dusk Lake's layers](../media/features/grease-pencil/layers.png)

> **Tip** Babylon's own stroke settings are in Properties > Data > Runtime (with the Bylonder icon): on Babylon
> (mapped), strokes can keep their thickness on screen at any distance (Size Attenuation) or draw dashed.

## Project files

- [grease-pencil.py](../../examples/grease-pencil/grease-pencil.py): builds the camera and its move, the layers at
  their depths, the materials and the drawings of each key, in Blender 5.2.
- [grease-pencil.blend](../../examples/grease-pencil/grease-pencil.blend): the file the script saves.
- [index.js](../../examples/grease-pencil/index.js): opens the .blend with Blender's reader.
- [2d-animation](../../examples/2d-animation/README.md): Blender's 2D Animation template, File > New > 2D Animation.
- Recorded by [record-grease-pencil.mjs](../../tools/docs/record-grease-pencil.mjs).
