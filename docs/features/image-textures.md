---
id: image-textures
title: Images and Image Textures
summary: Open, create, pack and save images with Blender's own readers and writers, view them in the Image Editor, and draw them on materials through the Image Texture node with Babylon's texture sampling, here a framed screen print, its paper grain and an oak floor, each an image.
expect: Images open, save, pack and draw on materials with Blender's readers; colors show with the Standard view, and Clip, Cubic, Box projection and UDIM sampling are simplified.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/image/index.html
  - https://docs.blender.org/manual/en/5.2/editors/image/image_settings.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/textures/image.html
  - https://docs.blender.org/manual/en/5.2/files/media/image_formats.html
example: framed-print
thumbnail: image-textures/thumbnail.png
media:
  - image-textures/image-editor.png
  - image-textures/image-node.png
  - image-textures/runtime.png
  - image-textures/render.png
ui:
  - IMAGE_EDITOR
  - NODE_EDITOR
  - IMAGE_HT_header
  - IMAGE_MT_editor_menus
  - IMAGE_MT_image*
  - IMAGE_MT_view*
  - IMAGE_PT_image*
  - IMAGE_PT_view*
  - TEXTURE_PT_image*
operators:
  - image.open
  - image.new
  - image.save_as
  - image.pack
  - image.unpack
  - image.reload
code:
  - src/imbuf/image-textures.js
  - src/editors/space_image/image-editor.js
  - src/editors/space_image/image-view.js
  - src/nodes/blender/shader-nodes.js
  - src/blenkernel/material/principled-gltf.js
  - src/runtimes/image.js
  - tools/blender-port/wasm/image-api.cc
tests:
  - tests/images-wasm.test.js
  - tests/texture-paint-wasm.test.js
  - tests/nodes-gpu.test.js
limits:
  - The color management files (OpenColorIO config and LUTs) are fetched on first use, not at startup, until the module is built with exceptions.
  - The view transform (AgX, Filmic) is not applied to what Babylon draws; images display with the Standard view.
  - An Image Texture node's Clip extension clamps to the edge pixels, as Babylon's samplers have no border color.
  - Interpolation belongs to the image's GPU texture, so two nodes sampling one image with different interpolation share the last one.
  - Cubic and Smart interpolation sample linearly.
  - Box, Sphere and Tube projection of the Image Texture node are drawn as Flat.
  - UDIM images draw their first tile only.
  - Compressed GPU texture formats are not offered.
  - A file libpng cannot read or write stops the module: libpng reports errors by longjmp, which the module cannot catch yet.
---
# Images and Image Textures

Images are Blender's Image data-blocks in Main, read and written by Blender's own image libraries in the module
(libjpeg-turbo, libpng, OpenEXR, OpenImageIO for TIFF, Radiance HDR, Targa, BMP and the others) with Blender's
OpenColorIO color management. Each image is drawn by one Babylon texture, which every user of the image shares: the
Image Editor, the Image Texture node of a material, Material Preview's Principled BSDF base color and Solid shading's
Texture color. When Blender changes the image (a paint stroke, a reload), only the changed regions reach the GPU.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=framed-print)

The demo, Framed Print, is a screen print of mountains at dusk framed on a gallery wall under a spotlight. Three
packed images make it: the print's colors (Dusk Print), its paper's grain as height (Paper Grain, Non-Color), and the
oak boards of the floor and the bench (Oak Boards). It is built by a Blender script (`framed-print.py`).

![The Framed Print rendered through the camera](../media/features/image-textures/render.png)

## Steps

1. **View an image.** Open the example and pick the Texture Paint workspace: its Image Editor shows Dusk Print. Any
   other Image Editor (Editor Type menu) shows an image picked in its header. Scroll zooms, middle drag pans and Home
   fits the image (View > Frame All). Image > Open reads a file from your computer with Blender's reader for its
   format; Image > New makes a generated image (Blank, UV Grid or Color Grid); Image > Save As writes a PNG copy to
   download. Saving the project or a .blend packs every image into it, since image files live only in the page's
   memory.

   ![The Image Editor showing Dusk Print](../media/features/image-textures/image-editor.png)

2. **Use it in a material.** Pick the Shading workspace: the Print's material has two Image Texture nodes. Dusk
   Print's Color feeds the Principled BSDF's Base Color; Paper Grain, read through Texture Coordinate's UV and a
   Mapping node that repeats it, feeds Bump's Height. In your own material, Shift A > Texture > Image Texture adds the
   node and its image menu picks the image. Material Preview and Rendered show it, and so does Solid shading with its
   Color set to Texture (the Viewport Shading popover).

   ![The Print material's Image Texture nodes](../media/features/image-textures/image-node.png)

3. **Choose its sampling.** In the UV Editing workspace, the UV Editor's sidebar Image tab has the image's Runtime
   panel (Bylonder icon). It keeps Blender's sampling (the node's interpolation and Preferences > Viewport > Textures >
   Anisotropic Filtering) or switches to Babylon (native) with Babylon's anisotropic filtering and mipmaps. The pixels
   stay Blender's either way.

   ![The image's Runtime panel](../media/features/image-textures/runtime.png)

## Project files

- [framed-print.py](../../examples/framed-print/framed-print.py): the Blender script that builds the demo and paints
  its three images.
- [framed-print.blend](../../examples/framed-print/framed-print.blend): the file the script saves, with its images
  packed.
- [index.js](../../examples/framed-print/index.js): opens the .blend with Blender's reader.
- Recorded by [record-texture-paint.mjs](../../tools/docs/record-texture-paint.mjs).
