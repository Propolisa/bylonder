---
id: light-probes
title: Light Probes
summary: Light a room with the light that bounces off its floor, walls and furniture, baked into an Irradiance Volume, and reflect it in glossy surfaces through a Sphere probe, as EEVEE does.
expect: Irradiance Volumes bake with Bake Light Cache and light every surface inside them with the bounced light and the sky they see, sampled, blended at their borders and biased as EEVEE samples them, so a sunlit room fills with warm light where EEVEE's does; the bake itself gathers the same light by drawing the scene around each sample instead of EEVEE's surfels, measured against EEVEE's own bake of the same room it gives the same validity and visibility and close irradiance, and it saves in the .blend, where a file EEVEE baked opens with its bake. Sphere probes reflect the room in glossy surfaces with EEVEE's parallax and are drawn again as the scene changes; each object takes one probe, where EEVEE picks per pixel.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/render/eevee/light_probes/introduction.html
  - https://docs.blender.org/manual/en/5.2/render/eevee/light_probes/volume.html
  - https://docs.blender.org/manual/en/5.2/render/eevee/light_probes/sphere.html
  - https://docs.blender.org/manual/en/5.2/render/eevee/render_settings/light_probes.html
example: light-probes
thumbnail: light-probes/thumbnail.png
media:
  - light-probes/shading.gif
  - light-probes/volume.png
  - light-probes/bake.gif
  - light-probes/sphere.png
  - light-probes/delete.gif
  - light-probes/render-image.png
ui:
  - VIEW_3D
  - PROPERTIES
  - VIEW3D_MT_lightprobe_add
  - DATA_PT_context_lightprobe
  - DATA_PT_lightprobe_eevee
  - DATA_PT_lightprobe_capture
  - DATA_PT_lightprobe_bake*
  - DATA_PT_lightprobe_parallax
  - DATA_PT_lightprobe_display_eevee
  - SCENE_PT_eevee_light_probes
operators:
  - object.lightprobe_add
  - object.lightprobe_cache_bake
  - object.lightprobe_cache_free
  - view3d.view_camera
  - render.render
code:
  - src/draw/light-probes.js
  - src/draw/light-probe-cache.js
  - src/draw/light-probe-pbr.js
  - src/draw/volume-probe-atlas.js
  - src/draw/volume-probe-shader.js
  - src/draw/spherical-harmonics.js
  - src/nodes/blender/shader-nodes.js
  - tools/blender-port/wasm/lightprobe-api.cc
tests:
  - tests/light-probe-sh.test.js
  - tests/light-probe-pbr.test.js
  - tests/light-probe-cache-wasm.test.js
  - tests/e2e/smoke.mjs
limits:
  - The bake draws the scene in a small cube around each grid sample and gathers three bounces of light, where EEVEE traces rays between surfels until its samples run out; Bake Samples, Surfel Resolution and the Offset settings (Surface Bias, Escape Bias) are not used.
  - A bake draws one grid sample a frame, so a grid of a few hundred samples takes several seconds; the views keep drawing meanwhile.
  - Surfaces outside the grid add no bounced light during a bake (EEVEE's surfels there still bounce light), so a grid that stops short of the walls lights the room a little less.
  - Capture Emission is always on, and a capture's shadows are the lights' shadow maps as the views have them.
  - Plane probes reflect nothing yet; glossy surfaces near one take the Sphere probe's or the world's reflection.
  - Each object reflects one Sphere probe, the one whose influence holds its center, where EEVEE picks a probe per pixel; Sphere probes are drawn at 256 pixels a side whatever the scene's Sphere Resolution.
  - Light probes have no Babylon runtime: Babylon's own reflection probes have no irradiance volumes, and an export to Babylon leaves the bake out.
---
# Light Probes

A light probe records the light at a place in the scene so that EEVEE can light surfaces with what bounces around them,
not only with what comes straight from the lights and the sky. An **Irradiance Volume** is a grid of samples that,
once baked, holds the diffuse light arriving at each one: the floor's sunlit patch warming the ceiling, a red wall
tinting what faces it. A **Sphere** probe draws the scene around it into a cube that glossy surfaces near it reflect.
Bylonder bakes and samples them as EEVEE does, in Material Preview and Rendered shading.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=light-probes)

The demo, Reading Corner, is made in Blender by a script (`light-probes.py`): a room lit only by a low sun through one
window, an armchair, a side table with a glazed vase, a lamp, books and a plant, with an Irradiance Volume filling the
room and a Sphere probe at the corner.

## Steps

1. **Rendered shading.** Look through the camera (Numpad 0) and pick Rendered (Z > Rendered). Before a bake, every
   surface out of the sun takes the sky's light alone, flat and blue.

   ![Solid, then Rendered shading](../media/features/light-probes/shading.gif)

2. **The Irradiance Volume.** Select Room Volume, a box just inside the walls. Its Resolution is its grid of samples;
   Capture says what it gathers (Indirect Light, Emission, and the World when it is outside).

   ![Room Volume in Properties > Light Probe](../media/features/light-probes/volume.png)

3. **Bake Light Cache.** Properties > Light Probe > Bake > Bake Light Cache. The room fills with the light the floor
   and walls send back: the ceiling warms, the armchair's shadow side picks up the rug's color.

   ![Bake Light Cache](../media/features/light-probes/bake.gif)

4. **The Sphere probe.** Select Corner Sphere. Its Distance is how far its influence reaches; inside it, the vase
   reflects the room as the probe saw it, corrected for where the vase stands.

   ![Corner Sphere in Properties > Light Probe](../media/features/light-probes/sphere.png)

5. **Delete and bake again.** The trash button beside Bake Light Cache deletes the bake: the room goes back to the
   sky's light alone. Bake again after moving the sun or the furniture.

   ![Delete Light Cache, then Bake Light Cache](../media/features/light-probes/delete.gif)

6. **Render Image.** Render > Render Image (F12) renders through the camera with the bake.

   ![Render > Render Image](../media/features/light-probes/render-image.png)

## Project files

- [light-probes.py](../../examples/light-probes/light-probes.py): builds the room, its window and furniture, the
  materials, the sun, the Irradiance Volume and the Sphere probe, and the camera, in Blender 5.2.
- [light-probes.blend](../../examples/light-probes/light-probes.blend): the file the script saves.
- [index.js](../../examples/light-probes/index.js): opens the .blend with Blender's reader.
- Recorded by [record-light-probes.mjs](../../tools/docs/record-light-probes.mjs).
