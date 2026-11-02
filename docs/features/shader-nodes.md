---
id: shader-nodes
title: Shader Nodes
summary: Build a material from Blender's shader nodes in the Shader Editor, here a glowing lava on a sphere displaced by a Clouds texture.
expect: 76 of Blender's shader nodes run; textures, converters and inputs run Blender's GLSL and match EEVEE pixel for pixel, while shaders are Babylon's PBR lighting, close to EEVEE but not equal; Material Preview uses Babylon's studio light.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/shader_editor.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/index.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/shader/index.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/textures/index.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/input/index.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/utilities/index.html
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
  - VIEW_3D
  - PROPERTIES
  - VIEW3D_MT_add
  - NODE_HT_header
  - NODE_MT_add
  - NODE_MT_category_shader*
  - NODE_MT_shader_node_add_all
  - NODE_PT_material_slots
  - EEVEE_MATERIAL_PT_*
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
  - src/blenkernel/colortools.js
  - tools/blender-nodes/gpu.py
  - tools/blender-port/wasm/shader-node-api.cc
  - src/editors/space_node/node-editor.js
tests:
  - tests/nodes-gpu.test.js
  - tests/nodes.test.js
  - tests/textures-wasm.test.js
  - tests/e2e/lava.mjs
  - tests/e2e/smoke.mjs
  - tools/blender-reference/node-fixtures.py
  - examples/shader-gallery/shader_gallery.py
  - tools/blender-reference/shader-gallery-diff.py
limits:
  - Material Preview lights the scene with Babylon's studio environment, not Blender's forest.exr.
  - Bump takes the height's screen derivatives (Blender's fast path), not the height again at offset points.
  - Principled BSDF's sockets are one list, without Blender's collapsible panels.
  - The Texture tab's preview is empty.
  - A material's closures are merged into one set of parameters (their colors, roughness, IOR and normals as they weigh) and lit once by Babylon's PBR model, so a mix of a rough and a sharp Glossy is one lobe of middle roughness, not two (Shader Node Gallery sphere 17, mean dE 17.2, max 51).
  - Glossy, Metallic and Anisotropic BSDF draw without their distribution choice, anisotropy, F82 tint or thin film.
  - Sheen draws as a diffuse closure of its color, as EEVEE does; Subsurface Scattering and Translucent draw as diffuse, without scattering or light from behind.
  - Lights have no angle or soft radius: a sharp highlight of the sun is smaller and hotter than EEVEE's (Glossy, sphere 12, mean dE 27.6, max 91).
  - The world reflects as Babylon's environment, without EEVEE's world probe: a flat world color is not reflected or diffused as EEVEE does.
  - Glass and Refraction BSDF refract Babylon's environment only, not the objects behind them nor a flat world color, and keep a reflection (Glass, sphere 18, mean dE 22.8).
  - Render Image anti-aliases with fewer samples than EEVEE's 64, and shows a faint afterimage of an earlier frame; texture edges and fine detail differ (Brick, sphere 4, mean dE 10.0, max 34).
  - Blender's view transforms other than Standard are approximated by Babylon's tone mapping.
  - A Transparent BSDF's color lets through its average, not each channel; Holdout draws black, not a hole in the film.
  - Light Path takes every ray as a camera ray; Ambient Occlusion finds no occlusion; Shader to RGB does not run.
  - Normal Map and Tangent read Blender's tangents of the active UV map; for another UV map, or a mesh Blender does not draw, they take the tangent from the UV map's screen derivatives.
  - Attribute, Color Attribute and a named UV Map read the attributes of meshes Blender draws, not of Babylon's own meshes.
  - Object Info's Material Index is 0; Geometry's Parametric and Random Per Island are 0.
  - Curves nodes draw the curves a file holds; the node has no curve widget to edit them.
  - Material Output's Displacement is not applied; a texture node's legacy texture mapping is ignored.
  - Not run yet: Wireframe, Point Info, Particle Info, the volume nodes, Script, Sky, Environment and IES textures, Toon BSDF, Specular BSDF, Ray Portal, Raycast, AOV Output and node groups.
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

The [Shader Node Gallery](https://propolisa.github.io/bylonder/#example=shader-gallery) example shows twenty materials of
Blender's common nodes; the smoke test renders it and compares each sphere with EEVEE's render of the same file
(`tests/fixtures/shader-gallery-eevee.png`, Standard view transform), and
`tools/blender-reference/shader-gallery-diff.py` measures each sphere's error in display space (CIE76 dE, mean and 99th
percentile inside the sphere). Measured with Render Image of the production build at 256 by 320 (not yet under the aim of mean dE 3 and max 10 for
the textures, 8 for the shaders):

| Sphere | dE mean | dE max | Sphere | dE mean | dE max |
|---|---|---|---|---|---|
| 1 Checker | 6.1 | 16.4 | 11 Principled | 6.4 | 32.4 |
| 2 Voronoi | 4.2 | 14.8 | 12 Glossy | 27.6 | 91.0 |
| 3 Wave | 4.9 | 15.6 | 13 Diffuse and Glossy mix | 6.0 | 21.0 |
| 4 Brick | 10.0 | 33.8 | 14 Diffuse plus Emission | 3.0 | 3.9 |
| 5 Magic | 4.1 | 6.3 | 15 Sheen | 8.5 | 14.4 |
| 6 Gradient | 4.2 | 4.8 | 16 Normal Map | 4.3 | 13.6 |
| 7 Geometry normal | 3.7 | 5.3 | 17 Two Glossy lobes | 17.2 | 50.8 |
| 8 Fresnel | 2.8 | 3.1 | 18 Glass | 22.8 | 23.5 |
| 9 Layer Weight | 2.3 | 3.0 | 19 Half transparent | 10.5 | 20.0 |
| 10 White Noise | 4.0 | 9.8 | 20 Metallic Principled | 27.8 | 93.0 |

> **Note** The header's Babylon Editor toggle opens the same graph in Babylon's Node Material Editor; both editors
> keep one layout.

## Project files

- [lava.py](../../examples/lava/lava.py): builds the sphere, its modifiers, the texture and the material in Blender
  5.2.
- [lava.blend](../../examples/lava/lava.blend): the file the script saves.
- [index.js](../../examples/lava/index.js): opens the .blend with Blender's reader.
- [shader_gallery.py](../../examples/shader-gallery/shader_gallery.py): builds the Shader Node Gallery and renders it
  in EEVEE, the reference the smoke test compares with.
- [lava.mjs](../../tests/e2e/lava.mjs): the steps as real input, used by the smoke test and by
  [record-shader-nodes.mjs](../../tools/docs/record-shader-nodes.mjs).
