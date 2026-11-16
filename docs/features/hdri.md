---
id: hdri
title: HDRI Authoring
summary: Render an environment map of a scene with Cycles through a panoramic camera and save it as Radiance HDR or OpenEXR, with its full range.
expect: Blender's own steps work as in Blender (a panoramic Cycles render saved by Blender's image writer keeps its full range); a render of any size takes as long as a Cycles still does in the page, several times slower than desktop Blender.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/render/cycles/object_settings/cameras.html
  - https://docs.blender.org/manual/en/5.2/render/output/properties/output.html
example: rendering
thumbnail: hdri/thumbnail.png
media:
  - hdri/panoramic.png
  - hdri/output.png
  - hdri/render.gif
  - hdri/render-result.png
ui:
  - PROPERTIES
  - RENDER_PT_context
  - DATA_PT_lens
  - RENDER_PT_format
  - RENDER_PT_output
  - TOPBAR_MT_render
operators:
  - render.render
code:
  - src/editors/render/cycles-source.js
  - src/editors/render/host.js
  - src/render/cycles-panels.js
  - src/makesrna/rna-bylonder.js
tests:
  - tests/hdri-wasm.test.js
limits:
  - Panoramic cameras render with Cycles only, as in Blender; EEVEE renders them as perspective.
  - Render Result's Save As writes a Cycles still in any format Blender writes; an EEVEE still is saved by the browser, so a float format falls back to PNG.
  - The file is downloaded; saving straight into the project's folder is not done yet.
  - Opening it as the World's environment inside Bylonder is not done yet (the World's Surface takes a Color only).
---
# HDRI Authoring

An HDRI is an environment map: the light around a point, in every direction, with its full range. Blender makes one
with Cycles and a panoramic camera: the camera sees the whole sphere around it, unrolled into an equirectangular image
twice as wide as high, and Blender's image writer keeps the light above white in a Radiance HDR or OpenEXR file. That
file can light a World in Blender, an exported page's code (Babylon's HDRCubeTexture) or any tool that takes an HDRI.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=rendering)

The demo is Window Light, the Rendering page's scene, captured from its camera's place by the table.

## Steps

1. **Cycles as the render engine.** Properties > Render > Render Engine: Cycles (see Cycles).

2. **A panoramic camera.** With the camera selected, Properties > Camera > Lens > Type: Panoramic, Panorama Type:
   Equirectangular.

   ![Lens > Type: Panoramic, Equirectangular](../media/features/hdri/panoramic.png)

3. **The output.** Properties > Output > Format: a resolution twice as wide as high (1024 x 512 here); Output > File
   Format: Radiance HDR (or OpenEXR).

   ![Output > File Format: Radiance HDR](../media/features/hdri/output.png)

4. **Render Image.** Render > Render Image (F12) renders the sphere around the camera.

   ![Render > Render Image of the panorama](../media/features/hdri/render.gif)

5. **Save As.** The Render Result window's Save As writes the file with Blender's image writer, so it keeps the light
   above white.

   ![The panorama in the Render Result window](../media/features/hdri/render-result.png)

## Project files

- [rendering.py](../../examples/rendering/rendering.py): builds Window Light, in Blender 5.2.
- [rendering.blend](../../examples/rendering/rendering.blend): the file the script saves.
- Recorded by [record-hdri.mjs](../../tools/docs/record-hdri.mjs).
