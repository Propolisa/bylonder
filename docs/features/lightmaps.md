---
id: lightmaps
title: Lightmaps
summary: Bake a scene's light with Cycles in the app and draw it in an exported page, each object's lightmap set in Object properties > Lightmap and drawn with Babylon's own lightmapTexture.
expect: Bake Lightmaps (Render properties > Bake > Lightmaps) bakes the selected meshes with Blender's own Cycles bake on the page's processors, denoises with Open Image Denoise on WebGPU and sets each object's lightmap, as desktop Blender bakes the example; an object's Lightmap setting names a baked image and the UV map it is laid out on, and File > Export > JavaScript draws the object with it through Babylon's lightmapTexture on a copy of its material, so the page shows Cycles' soft light, bounce and contact shadows at the cost of a texture read; the copy is Babylon's PBRMaterial made from the material's Principled BSDF values, so node setups beyond them are not carried, and the app's own views still light the object live.
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
  - lightmaps/bake-panel.png
  - lightmaps/bake.gif
  - lightmaps/room-baked.png
  - lightmaps/compare.png
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
  - src/render/bake-lightmaps.js
  - src/render/bylonder_lightmaps.py
  - src/render/denoise.js
  - src/io_scene_babylon/lightmaps.js
  - src/io_scene_babylon/babylon-export.js
  - src/io_scene_babylon/js-export.js
  - src/runtimes/runtimes.js
tests:
  - tests/bake-lightmaps-wasm.test.js
  - tests/meditation-wasm.test.js
limits:
  - Lightmaps are drawn only in exported pages; the app's 3D Viewport and Render Image light the object live, as Blender does.
  - The lightmapped copy of a material takes its Principled BSDF's unlinked Base Color, Roughness and Metallic (else its viewport display values); textures and other nodes of the material are not carried.
  - An image is a PNG or JPEG of 8 bits scaled by Intensity; Bake Lightmaps sets Intensity to the brightest light, so nothing clips, but HDR lightmaps (EXR, RGBD) are not read.
  - Bake Lightmaps needs Cycles, so a cross-origin isolated page with threads (see Cycles); it bakes on the CPU, several times slower than desktop Blender.
  - Denoising needs WebGPU; without it the lightmaps are stored as baked, noisy, and the Info editor says so.
  - Resolution is for new lightmaps (1024 px by default): an object with a lightmap image bakes at its size.
  - The page waits while each bake runs (Blender's bake on the page's thread, about 2 minutes for a 2048 px lightmap at 64 samples); the status bar names the object baking, and Cancel takes effect after the bake running. Bakes as Blender's job, while the page goes on, wait for a fix in Cycles' threads.
  - uv.lightmap_pack from the UV menu does not run in the app yet; Bake Lightmaps makes its UV map with Lightmap Pack's own function.
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
Direct off, it is the light the object gives back of everything but the lights' direct light (Diffuse with Color, less
the lights' direct light), and it adds to the lights, which still light the object live. Bake Lightmaps bakes by this
rule, so no bake nodes are wired by hand.

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

4. **Cycles.** Properties > Render > Render Engine: Cycles. Render properties > Bake > Lightmaps has Bylonder's Bake
   Lightmaps, with the Resolution of new lightmaps and the Samples of each bake.

   ![Render properties > Bake > Lightmaps](../media/features/lightmaps/bake-panel.png)

5. **Bake.** Select the room and press Bake Lightmaps. Each selected mesh gets a UV map named Lightmap (Lightmap Pack,
   where it has none) and is baked by Blender's own bake (Bake Type Diffuse, by its Direct), while the page waits;
   the status bar names the object baking and how far Bake Lightmaps is, and its Cancel stops it after that bake. The light is denoised by Open Image
   Denoise, guided by the surface's normals and colour, then stored over its brightest value as a JPEG packed in the
   .blend, its Intensity that value, and set in Object properties > Lightmap. No bake nodes are left behind. The
   example's room is baked with the turtle's Object properties > Visibility > Ray Visibility > Diffuse off, so the floor
   under the inlay bakes as if it were not there; then the turtle, the cushion, the bench, the bowl and the figure.

   ![Bake Lightmaps of the room](../media/features/lightmaps/bake.gif)

   ![The room's new lightmap](../media/features/lightmaps/room-baked.png)

6. **Export.** File > Export > JavaScript: the page draws each lightmapped object with a copy of its material that
   reads the lightmap through the second UV map. The app's bake and desktop Blender's (`meditation.py`, which bakes
   with the same code) draw the same page:

   ![Desktop Blender's bake and Bylonder's, in the exported page](../media/features/lightmaps/compare.png)

## Project files

- [meditation.py](../../examples/meditation/meditation.py): builds the room, the turtle, the cushion, the bench, the
  figure's pose and action, the sun and the camera, then bakes the lightmaps with Cycles in Blender 5.2, through
  Bake Lightmaps' own code ([bylonder_lightmaps.py](../../src/render/bylonder_lightmaps.py)).
- [meditation.blend](../../examples/meditation/meditation.blend): the file the script saves.
- [index.js](../../examples/meditation/index.js): opens the .blend with Blender's reader.
- Recorded by [record-lightmaps.mjs](../../tools/docs/record-lightmaps.mjs).
