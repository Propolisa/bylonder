---
id: image-textures
title: Images and Image Textures
summary: Open, create, pack and save images with Blender's own readers and writers, view them in the Image Editor, and draw them on materials through the Image Texture node with Babylon's texture sampling.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/image/index.html
  - https://docs.blender.org/manual/en/5.2/editors/image/image_settings.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/textures/image.html
  - https://docs.blender.org/manual/en/5.2/files/media/image_formats.html
example: texture-paint
thumbnail: image-textures/thumbnail.png
media:
  - image-textures/image-editor.png
  - image-textures/new-image.gif
  - image-textures/image-node.png
  - image-textures/runtime.png
ui:
  - IMAGE_EDITOR
  - IMAGE_HT_header
  - IMAGE_MT_image
  - IMAGE_MT_view
  - NODE_EDITOR
  - IMAGE_PT_image_properties
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
---
# Images and Image Textures

Images are Blender's Image data-blocks in Main, read and written by Blender's own image libraries in the module
(libjpeg-turbo, libpng, OpenEXR, OpenImageIO for TIFF, Radiance HDR, Targa, BMP and the others) with Blender's
OpenColorIO color management. Each image is drawn by one Babylon texture, which every user of the image shares: the
Image Editor, the Image Texture node of a material, Material Preview's Principled BSDF base color and Solid shading's
Texture color. When Blender changes the image (a paint stroke, a reload), only the changed regions reach the GPU.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=texture-paint)

The demo, Texture Paint, has a packed image, Suzanne Paint, in the Base Color of Suzanne's material.

## Steps

1. **View an image.** The Texture Paint workspace's Image Editor shows Suzanne Paint; any other Image Editor (Editor
   Type menu) shows an image picked in its header. Scroll zooms, middle drag pans and Home fits the image (View > Frame
   All). The sidebar (N) shows the image's settings in its Image tab.

   ![The Image Editor showing Suzanne Paint](../media/features/image-textures/image-editor.png)

2. **Open or create an image.** Image > Open reads a file from your computer with Blender's reader for its format.
   Image > New makes a generated image: Blank, UV Grid or Color Grid, at the size and color given. Image > Pack
   keeps it in the .blend; Image > Save As writes a PNG copy to download.

   ![Image > New, Color Grid](../media/features/image-textures/new-image.gif)

3. **Use it in a material.** In the Shader Editor add Texture > Image Texture, pick the image and link Color to the
   Principled BSDF's Base Color. Material Preview and Rendered show it, and so does Solid shading with its Color set
   to Texture (the Viewport Shading popover). An Image texture (Texture tab) shows an image to modifiers such as
   Displace.

   ![An Image Texture node feeding Base Color](../media/features/image-textures/image-node.png)

4. **Choose its sampling.** The image's Runtime panel (Image Editor sidebar, Image tab, Bylonder icon) keeps Blender's
   sampling (the node's interpolation and Preferences > Viewport > Textures > Anisotropic Filtering) or switches to
   Babylon (native) with Babylon's anisotropic filtering and mipmaps. The pixels stay Blender's either way.

   ![The Runtime panel set to Babylon (native)](../media/features/image-textures/runtime.png)

## Project files

- `examples/texture-paint/texture-paint.py`: the Blender script that builds the demo.
- `examples/texture-paint/texture-paint.blend`: the demo, with its image packed.

## Not done yet

See the limits above.
