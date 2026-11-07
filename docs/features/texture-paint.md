---
id: texture-paint
title: Texture Paint and Vertex Paint
summary: Paint an object's image texture in the 3D Viewport or the Image Editor with Blender's brushes and projection painting, and paint its color attribute in Vertex Paint Mode, here a vase hand painted in cobalt and a dish with a blue rim.
expect: Painting in the 3D Viewport, the Image Editor and Vertex Paint runs Blender's brushes; colors show with the Standard view, and brush textures are not drawn in the cursor.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/texture_paint/index.html
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/texture_paint/tool_settings/texture_slots.html
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/vertex_paint/index.html
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/brush/index.html
example: texture-paint
thumbnail: texture-paint/thumbnail.png
media:
  - texture-paint/workspace.png
  - texture-paint/paint-3d.gif
  - texture-paint/paint-2d.gif
  - texture-paint/vertex-paint.gif
  - texture-paint/render.png
ui:
  - TEXTURE_PAINT
  - VERTEX_PAINT
  - VIEW_3D
  - IMAGE_EDITOR
  - builtin.brush
  - VIEW3D_MT_paint_vertex
  - VIEW3D_PT_slots_projectpaint
  - VIEW3D_PT_slots_color_attributes
  - VIEW3D_PT_slots_paint_canvas
  - VIEW3D_PT_tools_brush*
  - VIEW3D_PT_tools_imagepaint*
  - VIEW3D_PT_tools_vertexpaint*
  - VIEW3D_PT_paint_texture_context_menu
  - VIEW3D_PT_paint_vertex_context_menu
  - IMAGE_PT_paint*
  - IMAGE_PT_tools_active
operators:
  - paint.texture_paint_toggle
  - paint.vertex_paint_toggle
  - paint.image_paint
  - paint.vertex_paint
  - paint.sample_color
  - paint.add_texture_paint_slot
  - paint.brush_colors_flip
  - ed.undo
code:
  - src/imbuf/image-textures.js
  - src/draw/workbench.js
  - src/editors/space_image/image-editor.js
  - src/editors/space_image/image-view.js
  - src/editors/screen/blender-area.js
  - src/editors/object/main-modes.js
  - tools/blender-port/wasm/image-api.cc
tests:
  - tests/texture-paint-wasm.test.js
limits:
  - The color management's view transform (AgX, Filmic) is not applied to what Babylon draws; images display with the Standard view.
  - Brush textures and masks (Texture and Texture Mask panels) are not drawn in the brush cursor.
  - Clone and Smear brushes paint only within one image; Clone from another image's UV map is not checked.
  - In Texture Paint Mode, Numpad 0 and Numpad . do not move the view.
---
# Texture Paint and Vertex Paint

Texture Paint Mode paints into an image that an object's material shows through its UV map; Vertex Paint Mode paints
the object's color attribute. Strokes run Blender's own paint code in the module (projection painting into the image's
buffer, `paint.image_paint`), and Babylon draws the result: each stroke uploads only the regions of the image it
changed, and the image's mipmaps are made again once painting pauses. Ctrl Z undoes one stroke.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=texture-paint)

The demo, Texture Paint, is a glazed vase hand painted in cobalt and a small dish, on a wooden table in low window
light. The vase's paint is a packed 2048 by 1024 image over a cylindrical unwrap; the dish's blue rim is a color
attribute. It is built by a Blender script (`texture-paint.py`), which also sets the brushes to cobalt, so the steps
below start from the example.

![The vase and the dish rendered through the camera](../media/features/texture-paint/render.png)

## Steps

1. **Open the Texture Paint workspace.** Pick Texture Paint in the topbar's workspace tabs. The vase enters Texture
   Paint Mode; the Image Editor on the left shows the image it paints, the 3D Viewport shows the image on the vase
   (Solid shading draws the paint slot's texture, as Blender's Workbench does in this mode).

   ![The Texture Paint workspace with the vase's image](../media/features/texture-paint/workspace.png)

2. **Paint on the object.** Drag over the vase in the 3D Viewport: the Draw brush paints its color from the tool
   settings onto the image through the UV map, here a wave around the shoulder. [ and ] change the brush size, Shift X over
   a pixel samples its color, and X swaps the two colors. A model without an image has none to paint: Texture Slots
   (the tool settings' popover) adds one with its + button.

   ![A wave painted around the vase](../media/features/texture-paint/paint-3d.gif)

3. **Paint in the Image Editor.** Drag in the Image Editor: in Paint mode it paints the image directly, and the 3D
   Viewport follows the stroke. Its toolbar and sidebar hold the same brushes and brush settings.

   ![A stroke in the Image Editor shows on the vase](../media/features/texture-paint/paint-2d.gif)

4. **Vertex Paint.** In the Layout workspace click the dish in the Outliner, switch the mode menu from Object Mode to
   Vertex Paint and drag over it. Strokes change its active color attribute (Object Data tab, Color Attributes),
   which Solid shading draws and its material reads through a Color Attribute node.

   ![A stroke on the dish in Vertex Paint Mode](../media/features/texture-paint/vertex-paint.gif)

## Project files

- [texture-paint.py](../../examples/texture-paint/texture-paint.py): the Blender script that builds the demo.
- [texture-paint.blend](../../examples/texture-paint/texture-paint.blend): the file the script saves, with its image
  packed.
- [index.js](../../examples/texture-paint/index.js): opens the .blend with Blender's reader.
- Recorded by [record-texture-paint.mjs](../../tools/docs/record-texture-paint.mjs).
