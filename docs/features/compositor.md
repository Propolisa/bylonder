---
id: compositor
title: Compositor
summary: Finish a render in Blender's Compositor, here a ramen bar's neon sign in a wet lane at night with Glare's Fog Glow, Lens Distortion, a Color Balance grade and a vignette, composited by Blender's own code.
expect: Render Image composites with Blender's own compositor, so every node renders as in Blender (Glare, Blur, Lens Distortion and the other multi-pass nodes included); the Compositor's backdrop and a Rendered view with Viewport Shading > Compositor on run the pixel nodes and Blender's own GPU passes for Glare, Blur, Lens Distortion, Kuwahara, Filter and the masks live; in camera view only the camera's frame is composited, as in Blender.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/compositing/index.html
  - https://docs.blender.org/manual/en/5.2/compositing/introduction.html
  - https://docs.blender.org/manual/en/5.2/compositing/types/filter/glare.html
  - https://docs.blender.org/manual/en/5.2/compositing/types/transform/lens_distortion.html
  - https://docs.blender.org/manual/en/5.2/compositing/types/color/adjust/color_balance.html
  - https://docs.blender.org/manual/en/5.2/compositing/types/mask/ellipse_mask.html
  - https://docs.blender.org/manual/en/5.2/compositing/sidebar.html
  - https://docs.blender.org/manual/en/5.2/editors/3dview/display/shading.html
example: compositor
thumbnail: compositor/thumbnail.png
media:
  - compositor/new.gif
  - compositor/color-balance.gif
  - compositor/tree.png
  - compositor/render-image.png
  - compositor/glare.png
  - compositor/loop.gif
ui:
  - NODE_EDITOR
  - CompositorNodeTree
  - NODE_HT_header
  - NODE_MT_add
  - NODE_MT_category_compositor*
  - NODE_MT_compositor_node_add_all
  - NODE_PT_backdrop
  - VIEW3D_PT_shading_compositor
  - RENDER_PT_post_processing
  - TOPBAR_MT_render
operators:
  - node.new_compositing_node_group
  - node.add_node
  - node.link
  - node.mute_toggle
  - node.delete
  - render.render
code:
  - src/compositor/compositor.js
  - src/compositor/compositor-tree.js
  - src/compositor/compositor-cpu.js
  - src/compositor/compositor-worker.js
  - src/nodes/blender/compositor-nodes.js
  - src/nodes/blender/compositor-io.js
  - src/nodes/blender/gpu-graph.js
  - src/editors/space_node/main-node-tree.js
  - src/editors/space_node/compositor-backdrop.js
  - tools/blender-port/wasm/compositor-api.cc
  - tools/blender-port/wasm/gpu-material-api.cc
tests:
  - tests/compositor-cpu-wasm.test.js
  - tests/compositor-read-wasm.test.js
  - tests/nodes-gpu.test.js
  - tests/nodes.test.js
  - tests/e2e/smoke.mjs
  - tools/blender-reference/compositor-fixtures.py
limits:
  - In the backdrop and the views, Glare's Fog Glow, Convolve, Normalize, Levels and nodes whose GPU shaders share memory between invocations (summed area tables, Keying Screen, anisotropic Displace and Map UV, Vector Blur) pass their image through; Render Image composites them.
  - The backdrop shows the composite through the scene camera at the output's aspect, not the Viewer node's image as Blender's does.
  - Render Layers gives the Image pass only; its other passes (Depth, Normal, Alpha and the like) and the Viewer's image are not made.
  - The Render window shows the composite, not the Viewer node's image; there is no Image Editor view of Viewer Node.
  - Node groups inside the compositing node group composite in Render Image only.
  - The puddles reflect the lights' highlights, not the sign, the window and the door: the view's screen-traced reflections do not reach node materials yet (Rendering).
  - In the Rendered view the example's steam (materials with Render Method Blended) draws opaque; Render Image blends it.
---
# Compositor

The Compositor finishes a render with nodes, as in Blender: the scene's compositing node group takes the render from
Render Layers and gives the Group Output the final image. Bylonder edits Blender's own node group, so the tree is the
one a .blend saves and Blender opens. Render > Render Image composites it with Blender's own compositor, every node as
Blender runs it; the Compositor's backdrop and a Rendered view with Viewport Shading > Compositor on show the pixel
nodes live.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=compositor)

The demo, Akari Noodle House, is a small ramen bar's neon sign in a narrow lane on a wet night, with customers at the counter
behind the window and the lane's lanterns mirrored in a puddle, built in Blender by
`compositor.py`. It is also a 10 s animation that loops: keyframes repeated by F-Curve Cycles modifiers sway the
lanterns and the noren, flicker the dead neon tube and move the woman's rig for a breath and a sip. The steps below make a compositing node group from the Default Cube, then open the example for its
tree and render.

## Steps

1. **A compositing node group.** Click the Compositing tab and New in the Compositor: Blender's new node group,
   Render Layers into the Group Output. The backdrop shows the render through the camera.

   ![Compositing > New](../media/features/compositor/new.gif)

2. **A grade.** Shift A, type Color Balance, Enter and click to place it. Drag from Render Layers' Image to its
   Image, and from its Image to the Group Output. Click Gain and type 1.8: the backdrop brightens.

   ![Adding and linking a Color Balance](../media/features/compositor/color-balance.gif)

3. **The example's tree.** Open the example. Render Layers goes through Glare (Fog Glow, Threshold 0.7, Size 0.85, Strength 1.8),
   which spreads a glow around everything brighter than the threshold, then Lens Distortion (Distortion -0.03,
   Dispersion 0.012) for a slight barrel and color fringes at the edges, and Color Balance (Lift a little blue, Gain a
   little warm). An Ellipse Mask, softened by a Blur, is multiplied over the image by a Mix for the vignette. A Viewer
   shows the result.

   ![The Akari Noodle House compositing node group](../media/features/compositor/tree.png)

4. **The render.** Render > Render Image renders through the camera and composites the result with Blender's
   compositor; the Render window shows Compositing while it runs.

   ![Render Image](../media/features/compositor/render-image.png)

5. **What Glare does.** Click Glare and press M to mute it, then Render Image again. Without it (left) the tubes, the
   window and the doorway are flat; with it (right) they glow.

   ![Glare muted, left, and on, right](../media/features/compositor/glare.png)

6. **The loop.** Press Space in the 3D Viewport to play the timeline: frames 1 to 240 run into each other.

   ![The example played through its camera in Rendered shading](../media/features/compositor/loop.gif)

## Project files

- [compositor.py](../../examples/compositor/compositor.py): builds the scene and its compositing node group in Blender
  5.2.
- [compositor.blend](../../examples/compositor/compositor.blend): the file the script saves.
- [fonts](../../examples/compositor/fonts): Zen Maru Gothic (a subset of the glyphs the scene uses) and Poiret One, with their SIL Open Font License files.
- [index.js](../../examples/compositor/index.js): opens the .blend with Blender's reader.
- Recorded by [record-compositor.mjs](../../tools/docs/record-compositor.mjs).
