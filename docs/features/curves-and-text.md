---
id: curves-and-text
title: Curves and Text
summary: Add a text object, type into it in Edit Mode, give it depth with Extrude and Bevel, and bevel a Bézier curve into a tube, here the letters and tubes of a neon sign.
expect: Text and Bezier curves are typed, edited, extruded and beveled as in Blender; in a curve's Edit Mode, View Selected does not frame the selected points.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/modeling/texts/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/texts/editing.html
  - https://docs.blender.org/manual/en/5.2/modeling/curves/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/curves/editing/index.html
example: neon-sign
thumbnail: curves-and-text/thumbnail.png
media:
  - curves-and-text/add-text.gif
  - curves-and-text/edit-text.gif
  - curves-and-text/extrude.gif
  - curves-and-text/tube.gif
  - curves-and-text/render.png
ui:
  - VIEW_3D
  - EDIT
  - VIEW3D_MT_add
  - VIEW3D_MT_curve_add
  - VIEW3D_MT_edit_font*
  - VIEW3D_MT_edit_curve_*
  - VIEW3D_MT_edit_curve
  - DATA_PT_font*
  - DATA_PT_geometry_curve*
  - DATA_PT_paragraph*
  - DATA_PT_text_boxes
  - DATA_PT_shape_curve
  - DATA_PT_pathanim
operators:
  - object.text_add
  - font.text_insert
  - font.delete
  - curve.primitive_bezier_curve_add
  - curve.primitive_bezier_circle_add
  - transform.resize
  - curve.extrude_move
  - object.editmode_toggle
code:
  - src/blenkernel/curve/curve.js
  - src/editors/curve/editcurve.js
  - src/draw/overlay-edit-curve.js
  - src/draw/overlay-edit-text.js
  - tools/blender-port/wasm/curve-api.cc
tests:
  - tests/curves-wasm.test.js
  - tests/text-wasm.test.js
  - tests/text.test.js
limits:
  - In a curve's Edit Mode, View Selected (Numpad .) does not frame the selected points.
  - In Solid shading, a beveled Bézier curve in Edit Mode can draw a black fill between its points and handles.
  - The 3D Text example builds its text from code with a Google Fonts family and needs network access; a text object added with Shift A uses Blender's built-in font.
---
# Curves and Text

Blender's Curve and Text objects are Blender's own data in the module: the text layout, the curve evaluation with
bevel and extrude, and Edit Mode on both (`docs/curves-and-text.md`). Tab enters Edit Mode, where a text takes typed
characters and a curve's points are selected, moved and extruded with Blender's operators and keymaps.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=neon-sign)

The demo, Neon Sign, is a sign on a brick wall at night: its words a text object, its frame and swoosh Bézier curves,
all beveled round so they read as glass tubes, built in Blender by `neon-sign.py`. The steps below make a text and a
tube by hand from the Default Cube.

## Steps

1. **Add a text.** Click the cube, press X > Delete, hover the viewport and press Shift A > Text. Numpad 7 looks from
   the top, where the text lies, and Numpad . frames it.

   ![Shift A > Text, then Numpad 7](../media/features/curves-and-text/add-text.gif)

2. **Type.** Press Tab for Edit Mode, Backspace four times to delete the word Text, type Open Late and press Tab to
   leave.

   ![Tab, Backspace, type Open Late, Tab](../media/features/curves-and-text/edit-text.gif)

3. **Give it depth.** In Properties > Data, open Geometry: Extrude 0.02 sets the thickness, and Bevel's Depth 0.03
   rounds the edges into a tube. Numpad 8 tilts the view to see them.

   ![Extrude 0.02 and Bevel Depth 0.03](../media/features/curves-and-text/extrude.gif)

4. **A tube.** Shift A > Curve > Circle adds a Bézier circle; S X 3 Enter stretches it into an oval around the words.
   In Properties > Data, Bevel's Depth 0.05 turns the curve into a round tube.

   ![Shift A > Curve > Circle, S X 3, Bevel Depth 0.05](../media/features/curves-and-text/tube.gif)

5. **The sign.** The example gives the words and the swoosh, a Bézier curve whose two points' handles draw a wave, a
   pink emissive material, and the oval a blue one. Two point lights in the tubes' colors light the wall, a Brick
   Texture. Numpad 0 and Rendered shading show it through the camera.

   ![The Neon Sign rendered through the camera](../media/features/curves-and-text/render.png)

## Project files

- [neon-sign.py](../../examples/neon-sign/neon-sign.py): builds the wall, the text, the curves, the materials and the
  lights in Blender 5.2.
- [neon-sign.blend](../../examples/neon-sign/neon-sign.blend): the file the script saves.
- [index.js](../../examples/neon-sign/index.js): opens the .blend with Blender's reader.
- Recorded by [record-curves-and-text.mjs](../../tools/docs/record-curves-and-text.mjs).
