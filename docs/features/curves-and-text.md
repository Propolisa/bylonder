---
id: curves-and-text
title: Curves and Text
summary: Add a text object, type into it in Edit Mode, give it depth with Extrude and Bevel, and extrude a Bézier curve's points.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/modeling/texts/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/texts/editing.html
  - https://docs.blender.org/manual/en/5.2/modeling/curves/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/curves/editing/index.html
example: text
thumbnail: curves-and-text/thumbnail.png
media:
  - curves-and-text/add-text.gif
  - curves-and-text/edit-text.gif
  - curves-and-text/extrude.gif
  - curves-and-text/curve.gif
ui:
  - VIEW_3D
  - VIEW3D_MT_add
  - VIEW3D_MT_curve_add
  - VIEW3D_MT_edit_font
  - VIEW3D_MT_edit_curve
  - DATA_PT_geometry_curve
  - DATA_PT_font
  - EDIT
operators:
  - object.text_add
  - font.text_insert
  - font.delete
  - curve.primitive_bezier_curve_add
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
  - The 3D Text example builds its text from code with a Google Fonts family and needs network access; a text object added with Shift A uses Blender's built-in font.
---
# Curves and Text

Blender's Curve and Text objects are Blender's own data in the module: the text layout, the curve evaluation with
bevel and extrude, and Edit Mode on both (`docs/curves-and-text.md`). Tab enters Edit Mode, where a text takes typed
characters and a curve's points are selected, moved and extruded with Blender's operators and keymaps.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=text)

The demo, 3D Text, is an extruded title in a Google Fonts family made from code. The steps below make a text and a
curve by hand from the Default Cube.

## Steps

1. **Add a text.** Click the cube, press X > Delete, hover the viewport and press Shift A > Text. Numpad 7 looks from
   the top, where the text lies.

   ![Shift A > Text, then Numpad 7](../media/features/curves-and-text/add-text.gif)

2. **Type.** Press Tab for Edit Mode, Backspace to delete the word Text, type a new one and press Tab to leave.

   ![Tab, Backspace, type Bylonder, Tab](../media/features/curves-and-text/edit-text.gif)

3. **Give it depth.** In Properties > Data, open Geometry: Extrude sets the thickness, and Bevel's Depth rounds the
   edges. Numpad 8 tilts the view to see them.

   ![Extrude 0.15 and Bevel Depth 0.03](../media/features/curves-and-text/extrude.gif)

4. **A curve.** Shift A > Curve > Bézier adds a curve. In Edit Mode, E extrudes the selected end point and the mouse
   places it; V sets handle types and Alt C closes the curve.

   ![Shift A > Curve > Bézier, Tab, E](../media/features/curves-and-text/curve.gif)

## Project files

- [index.js](../../examples/text/index.js): the title made from code with the project SDK, its font from Google
  Fonts and its settings in a store.
- Recorded by [record-curves-and-text.mjs](../../tools/docs/record-curves-and-text.mjs).
