---
id: lightmaps
title: Lightmaps
summary: Draw a scene's light baked in Cycles in an exported page, each object's lightmap set in Object properties > Lightmap and drawn with Babylon's own lightmapTexture.
expect: An object's Lightmap setting names a baked image and the UV map it is laid out on, and File > Export > JavaScript draws the object with it through Babylon's lightmapTexture on a copy of its material, so the page shows Cycles' soft light, bounce and contact shadows at the cost of a texture read; the copy is Babylon's PBRMaterial made from the material's Principled BSDF values, so node setups beyond them are not carried, and the app's own views still light the object live.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/render/cycles/baking.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/uv.html
  - https://docs.blender.org/manual/en/5.2/editors/graph_editor/fcurves/modifiers.html
example: meditation
thumbnail: lightmaps/thumbnail.png
media:
  - lightmaps/breathing.gif
  - lightmaps/room-lightmap.png
  - lightmaps/figure-lightmap.png
ui:
  - VIEW_3D
  - PROPERTIES
  - OBJECT_PT_context_object
  - DATA_PT_uv_texture
  - CYCLES_RENDER_PT_bake*
  - GRAPH_PT_modifiers
  - TOPBAR_MT_file_export
operators:
  - object.bake
  - uv.smart_project
  - uv.lightmap_pack
  - graph.fmodifier_add
code:
  - src/io_scene_babylon/lightmaps.js
  - src/io_scene_babylon/babylon-export.js
  - src/io_scene_babylon/js-export.js
  - src/runtimes/runtimes.js
tests:
  - tests/meditation-wasm.test.js
limits:
  - Lightmaps are drawn only in exported pages; the app's 3D Viewport and Render Image light the object live, as Blender does.
  - The lightmapped copy of a material takes its Principled BSDF's unlinked Base Color, Roughness and Metallic (else its viewport display values); textures and other nodes of the material are not carried.
  - An image is a PNG or JPEG of 8 bits scaled by Intensity, so light beyond Intensity clips; HDR lightmaps (EXR, RGBD) are not read.
  - Bylonder does not bake yet; the example bakes with desktop Blender's Cycles in its script.
  - A lightmap holds diffuse light only: a lightmapped surface loses its glossy reflections in the page, so the example's surfaces are matte.
  - Noise F-Curve modifiers play in a page as sampled keys, not live; Cycles modifiers play live.
---
# Lightmaps

A lightmap is an image of the light that reaches a surface, baked once with Cycles: soft shadows, light bouncing off
the floor onto the walls, the dark where a figure meets its cushion. A page that draws it reads one texture instead of
lighting the surface, so it shows the baked light at real-time cost. In Bylonder an object's lightmap is a setting of
its own, Object properties > Lightmap: the image, the UV map it is laid out on (a second UV map, so the material's own
stays as it is), its Intensity and Direct. File > Export > JavaScript draws the object with Babylon's lightmapTexture.

The rule for the image is what Babylon's lightmap slot expects: with Direct on, it is all the light reaching the object
without its colour (Bake Type Diffuse, Direct and Indirect, Color off), and it multiplies the material's colour; with
Direct off, it is the light the object gives back of everything but the lights' direct light (Diffuse, Indirect, Color
on), and it adds to the lights, which still light the object live.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=meditation)

The demo, Meditation, is made in Blender by a script (`meditation.py`): the mannequin seated cross-legged on a cushion
in an earthen room, a green turtle inlaid in the floor, low sun through an arched window and two round ports. The room,
the turtle, the cushion, the bench and the bowl carry lightmaps with Direct on; the figure's has Direct off, so the sun
lights him live while he breathes, sways and settles, which his rig's action does with keys, a Cycles modifier and Noise
modifiers.

## Steps

1. **The scene.** Look through the camera (Numpad 0), pick Rendered shading and play (Space): the figure breathes, the
   chest rising about a centimetre every 4.5 s, and sways too slowly to see at once.

   ![Rendered shading, playing](../media/features/lightmaps/breathing.gif)

2. **The room's lightmap.** Select Room and open Object properties > Lightmap: its image, its UV map, Lightmap, and its
   Intensity, the brightest light it holds. Direct is on: the image holds all the light that reaches the room.

   ![Room in Object properties > Lightmap](../media/features/lightmaps/room-lightmap.png)

3. **The figure's lightmap.** Select Mannequin: Direct is off, so its image holds only the sky's and the room's light,
   and the sun lights it live in the page, as he moves.

   ![Mannequin in Object properties > Lightmap](../media/features/lightmaps/figure-lightmap.png)

4. **Bake.** In desktop Blender: give each object a second UV map (UV Maps > +, then UV > Smart UV Project), pick Cycles,
   Render properties > Bake, Bake Type Diffuse with Color off for a Direct lightmap (Indirect and Color for the
   other), and Bake into an image node selected in its material. Save the image in the .blend (Image > Pack) and set it
   in Object properties > Lightmap. `meditation.py` does all of this.

5. **Export.** File > Export > JavaScript: the page draws each lightmapped object with a copy of its material that
   reads the lightmap through the second UV map.

## Project files

- [meditation.py](../../examples/meditation/meditation.py): builds the room, the turtle, the cushion, the bench, the
  figure's pose and action, the sun and the camera, then bakes the lightmaps with Cycles, in Blender 5.2.
- [meditation.blend](../../examples/meditation/meditation.blend): the file the script saves.
- [index.js](../../examples/meditation/index.js): opens the .blend with Blender's reader.
- Recorded by [record-lightmaps.mjs](../../tools/docs/record-lightmaps.mjs).
