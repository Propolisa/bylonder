---
id: shader-nodes
title: Shader Nodes
summary: Build a material from Blender's shader nodes in the Shader Editor, here a glowing lava on a sphere displaced by a Clouds texture.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/shader_editor.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/index.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/textures/noise.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/color/color_ramp.html
  - https://docs.blender.org/manual/en/5.2/modeling/modifiers/deform/displace.html
example: lava
thumbnail: shader-nodes/thumbnail.png
media:
  - shader-nodes/sphere.gif
  - shader-nodes/nodes.gif
  - shader-nodes/node-tree.png
ui:
  - ShaderNodeTree
  - NODE_EDITOR
  - NODE_MT_add
  - VIEW_3D
  - PROPERTIES
  - VIEW3D_MT_add
operators:
  - node.add_node
  - node.link
  - mesh.primitive_uv_sphere_add
  - object.modifier_add
  - texture.new
  - material.new
code:
  - src/nodes/blender/shader-nodes.js
  - src/nodes/blender/node-code.js
  - src/nodes/blender/glsl.js
  - src/editors/space_node/node-editor.js
tests:
  - tests/nodes-gpu.test.js
  - tests/nodes.test.js
  - tests/textures-wasm.test.js
  - tests/e2e/lava.mjs
limits:
  - Material Preview lights the scene with Babylon's studio environment, not Blender's forest.exr.
  - Bump takes the height's screen derivatives (Blender's fast path), not the height again at offset points.
  - Principled BSDF's sockets are one list, without Blender's collapsible panels.
  - The Texture tab's preview is empty.
---
# Shader Nodes

A material's surface is a tree of Blender's shader nodes in the Shader Editor. Each Blender node runs Blender's own
GLSL in Babylon's material, so a node computes what it computes in Blender; an input value changes without a rebuild,
a property such as a Noise Texture's dimensions rebuilds the material as Blender recompiles its shader
(`docs/node-editors.md`). The full workflow is written out in [A displaced lava sphere](../lava-material.md).

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=lava)

The demo, Lava Sphere, is the result made in Blender by `lava.py`. The steps below make it from the Default Cube.

## Steps

1. **The sphere.** In the Default Cube example, click the cube, press X > Delete, then Shift A > Mesh > UV Sphere. In
   Properties > Modifiers add Generate > Subdivision Surface and Deform > Displace. In the Displace panel, the
   Texture field's New makes a texture; in Properties > Texture set its Type to Clouds.

   ![Sphere, Subdivision Surface, Displace with a Clouds texture](../media/features/shader-nodes/sphere.gif)

2. **The lava material.** Click the Shading tab and New in the Shader Editor (Principled BSDF into Material Output).
   Shift A adds each node (type to search, Enter, click to place); drag from socket to socket to link:
   - Texture Coordinate's Object into two Noise Textures, both set to 4D.
   - The first Noise's Factor into a Color Ramp (black stop at 0.5, the other orange), its Color into Principled
     BSDF's Emission Color, and the Factor into Emission Strength.
   - The second Noise (Detail 8) into Bump's Height, Bump's Normal into Principled BSDF's Normal; a dark Base Color.

   ![Adding, setting and linking the nodes](../media/features/shader-nodes/nodes.gif)

3. **The result.** Material Preview shows the sphere glowing through its cracks. Every edit rebuilds the material.

   ![The finished tree](../media/features/shader-nodes/node-tree.png)

> **Note** The header's Babylon Editor toggle opens the same graph in Babylon's Node Material Editor; both editors
> keep one layout.

## Project files

- [lava.py](../../examples/lava/lava.py): builds the sphere, its modifiers, the texture and the material in Blender
  5.2.
- [lava.blend](../../examples/lava/lava.blend): the file the script saves.
- [index.js](../../examples/lava/index.js): opens the .blend with Blender's reader.
- [lava.mjs](../../tests/e2e/lava.mjs): the steps as real input, used by the smoke test and by
  [record-shader-nodes.mjs](../../tools/docs/record-shader-nodes.mjs).
