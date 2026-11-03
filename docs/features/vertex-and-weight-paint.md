---
id: vertex-and-weight-paint
title: Vertex and Weight Paint
summary: Paint a mesh's color attribute in Vertex Paint and a vertex group's weights in Weight Paint, here the markings of two koi and the part of them a modifier swings.
expect: Vertex Paint and Weight Paint, their brushes, strokes and overlays are Blender's code and paint as Blender does, one undo step per stroke; a material shows a color attribute through the Color Attribute node.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/vertex_paint/index.html
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/weight_paint/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/properties/vertex_groups/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/modifiers/deform/simple_deform.html
example: vertex-and-weight-paint
thumbnail: vertex-and-weight-paint/thumbnail.png
media:
  - vertex-and-weight-paint/vertex-paint.gif
  - vertex-and-weight-paint/attributes.png
  - vertex-and-weight-paint/weight-paint.gif
  - vertex-and-weight-paint/swim.gif
  - vertex-and-weight-paint/modifier.png
ui:
  - VIEW_3D
  - PROPERTIES
  - VERTEX_PAINT
  - WEIGHT_PAINT
  - VIEW3D_MT_paint_vertex
  - VIEW3D_MT_paint_weight
  - DATA_PT_vertex_groups
  - DATA_PT_vertex_colors
  - VIEW3D_PT_tools_weightpaint_options
operators:
  - object.mode_set
  - paint.vertex_paint
  - paint.weight_paint
  - object.vertex_group_add
  - geometry.color_attribute_add
  - object.modifier_add
  - screen.animation_play
code:
  - src/editors/object/main-modes.js
  - src/editors/space_view3d/view3d-window.js
tests:
  - tests/weight-paint-wasm.test.js
  - tests/texture-paint-wasm.test.js
limits:
  - The example's markings and weights are written by its script from noise and the length of the fish, not painted by recorded strokes.
---
# Vertex and Weight Paint

Vertex Paint paints colors into a mesh's color attribute, a color for each vertex (or face corner) that a material
reads with the Color Attribute node. Weight Paint paints a vertex group's weights, from 0 (blue) to 1 (red), which
modifiers, armatures and particles read to know how much of the mesh they act on. Both modes, their brushes and the
weight overlay are Blender's code in the module, and each stroke is one undo step.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=vertex-and-weight-paint)

The demo, Koi Pond, is made in Blender by a script (`vertex-and-weight-paint.py`): two koi, a Kohaku and a Showa,
under lily pads. Each fish's markings are its Markings color attribute; its Tail vertex group weighs 0 at the head and
1 at the tail, and a Simple Deform modifier limited to that group bends the tail back and forth.

## Steps

1. **Vertex Paint.** Select Kohaku, look from above (Numpad 7) and frame it, then pick Vertex Paint in the mode menu.
   A stroke along the back paints the brush's color, black here (its color is in the tool settings, and S samples one
   from under the pointer): the Kohaku gets a Sanke's black patch.

   ![Painting a black patch](../media/features/vertex-and-weight-paint/vertex-paint.gif)

2. **The color attribute.** Properties > Mesh lists Markings under Color Attributes, beside the Tail vertex group.
   The fish's material reads Markings with a Color Attribute node into its Base Color.

   ![Properties > Mesh](../media/features/vertex-and-weight-paint/attributes.png)

3. **Weight Paint.** Pick Weight Paint: the Tail group shows from blue at the head to red at the tail. A stroke across
   the middle of the body paints it toward 1, so more of the fish will bend.

   ![Painting the Tail group](../media/features/vertex-and-weight-paint/weight-paint.gif)

4. **Swim.** Back in Object Mode, in Material Preview, press Space: the Simple Deform's bend angle is keyed both
   ways, and the weights decide how much of the fish follows it.

   ![The koi swimming](../media/features/vertex-and-weight-paint/swim.gif)

5. **The modifier.** Properties > Modifiers: Simple Deform set to Bend about Z; under Restrictions, its Vertex Group
   is Tail.

   ![The Simple Deform modifier](../media/features/vertex-and-weight-paint/modifier.png)

## Project files

- [vertex-and-weight-paint.py](../../examples/vertex-and-weight-paint/vertex-and-weight-paint.py): builds the koi,
  their color attributes, vertex groups and modifiers, the pond, lights and camera, in Blender 5.2.
- [vertex-and-weight-paint.blend](../../examples/vertex-and-weight-paint/vertex-and-weight-paint.blend): the file the
  script saves.
- [index.js](../../examples/vertex-and-weight-paint/index.js): opens the .blend with Blender's reader.
- Recorded by [record-vertex-and-weight-paint.mjs](../../tools/docs/record-vertex-and-weight-paint.mjs).
