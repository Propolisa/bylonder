---
id: cycles
title: Cycles
summary: Render Image with Blender's own Cycles path tracer, run in the page on all its processors and fetched the first time the render engine becomes Cycles.
expect: A still renders as Blender's Cycles renders it on the CPU (the same image for the same samples and seed), several times slower than desktop Blender, without denoising; the page stays usable while it renders.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/render/cycles/index.html
  - https://docs.blender.org/manual/en/5.2/render/cycles/render_settings/sampling.html
  - https://docs.blender.org/manual/en/5.2/render/output/render_output.html
example: rendering
thumbnail: cycles/thumbnail.png
media:
  - cycles/engine-pick.gif
  - cycles/engine.png
  - cycles/render-image.gif
  - cycles/render-result.png
ui:
  - PROPERTIES
  - RENDER_PT_context
  - TOPBAR_MT_render
operators:
  - render.render
code:
  - src/render/cycles.js
  - src/editors/render/cycles-source.js
  - src/port/side-modules.js
  - tools/blender-port/wasm/cycles-api.cc
  - tools/blender-port/wasm/render-api.cc
tests:
  - tests/cycles-wasm.test.js
  - tests/threads-wasm.test.js
limits:
  - Cycles needs threads, so a cross-origin isolated page and Preferences > System > Bylonder > Threads on Auto; Safari, which cannot isolate a page this way, has no Cycles.
  - The CPU device only, on Cycles' plain kernel (WebAssembly has no SSE or AVX), several times slower than desktop Blender's CPU render; no GPU devices.
  - No denoising (OpenImageDenoise), no Open Shading Language, no Embree, no path guiding and no NanoVDB volumes yet.
  - Render Image of a still only; Render Animation, the 3D Viewport's Rendered shading and baking with Cycles are not done yet.
  - Cycles' panels in Properties > Render come with its add-on once it is fetched; Bylonder's own render panels for Babylon show beside them.
---
# Cycles

Cycles is Blender's path tracer, built from Blender's own sources as a module of its own that the page fetches the
first time the render engine becomes Cycles (about 1 MB compressed, with its add-on). It runs Blender's render job on
a thread of its own and traces on all the processors the page has, while the page goes on; Render Image shows the
result in the Render Result window, through the scene's view transform, as Blender shows it.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=rendering)

The demo is Window Light, the Rendering page's scene: a table by a window in late sun, rendered here by Cycles instead
of the EEVEE look.

## Steps

1. **Cycles as the render engine.** Properties > Render > Render Engine: Cycles. The first time, the page fetches
   Cycles and starts it, and its panels (Device, Sampling and the rest) join Properties > Render.

   ![Picking Cycles in Properties > Render](../media/features/cycles/engine-pick.gif)

   ![Cycles as the render engine](../media/features/cycles/engine.png)

2. **Render Image.** Render > Render Image (F12) renders through the scene camera at the output's resolution, here a
   quarter of it, in the Render Result window, which shows how far Cycles is; Cancel stops it.

   ![Render > Render Image with Cycles](../media/features/cycles/render-image.gif)

3. **The result.** The finished frame; Save As saves it.

   ![The Render Result window](../media/features/cycles/render-result.png)

## Project files

- [rendering.py](../../examples/rendering/rendering.py): builds the room, the objects, their materials, the lights,
  the world and the camera, in Blender 5.2.
- [rendering.blend](../../examples/rendering/rendering.blend): the file the script saves.
- Recorded by [record-cycles.mjs](../../tools/docs/record-cycles.mjs).
