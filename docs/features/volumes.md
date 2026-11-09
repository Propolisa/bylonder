---
id: volumes
title: Volumes
summary: Fill an object with fog, dust or smoke from a material's Volume shader and light it as EEVEE does, here sunset shafts through a temple's windows into drifting dust.
expect: Principled Volume, Volume Scatter and Volume Absorption on objects and the world draw in EEVEE's froxel grid from the scene's Volumes settings, lit by sun, spot and point lights through their shadows (light shafts) and by the world, close to EEVEE in shape, density and color; a volume fills its object's bounding box rather than its mesh, a 4D Noise Texture's density draws empty, and a moving view shows the grid's noise until it holds still.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/shader/volume_principled.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/shader/volume_scatter.html
  - https://docs.blender.org/manual/en/5.2/render/shader_nodes/shader/volume_absorption.html
  - https://docs.blender.org/manual/en/5.2/render/eevee/render_settings/volumes.html
  - https://docs.blender.org/manual/en/5.2/render/materials/components/volume.html
example: volumes
thumbnail: volumes/thumbnail.png
media:
  - volumes/shading.gif
  - volumes/dust.png
  - volumes/anisotropy.gif
  - volumes/sun-rotate.gif
  - volumes/cast-shadow.gif
  - volumes/settings.png
  - volumes/presets.png
  - volumes/play.gif
  - volumes/render-image.png
ui:
  - VIEW_3D
  - PROPERTIES
  - EEVEE_MATERIAL_PT_volume
  - EEVEE_MATERIAL_PT_settings_volume
  - EEVEE_WORLD_PT_volume
  - RENDER_PT_eevee_volumes*
  - RENDER_PT_eevee_clamping_volume
  - DATA_PT_EEVEE_light_shadow
operators:
  - view3d.toggle_shading
  - view3d.view_camera
  - screen.animation_play
  - render.render
code:
  - src/draw/volumes.js
  - src/draw/volume-shaders.js
  - src/nodes/blender/shader-nodes.js
  - src/blenkernel/scene/render-babylon.js
tests:
  - tests/volumes.test.js
limits:
  - A volume fills its object's bounding box, not its mesh's shape (EEVEE fills the mesh), so a sphere of fog is a box of fog; shape it with its density instead.
  - A Noise Texture in 4D (with W) gives a volume no density yet; 1D, 2D and 3D work.
  - A volume object's grids (OpenVDB) are not drawn; a mesh's volume reads no attributes, so a Density Attribute is 1 and a Temperature Attribute 0.
  - Volumes show behind opaque surfaces only: a blended surface in front of a volume does not hide it, and volumes cast no shadow onto surfaces.
  - Shadows in volumes take one depth comparison per froxel (EEVEE filters them); area lights light volumes from their center on both sides and cast no shadow into them.
  - The grid's noise averages away while the view holds still (EEVEE reprojects it as the view moves too), so a moving view shows it in thin fog.
  - Volumes are Bylonder's render extension (Properties > Render > Volumes, Bylonder icon), with no Babylon runtime: Babylon's fog is a depth tint, not a volume, and an export to Babylon leaves volumes out.
---
# Volumes

A material's Volume output fills its object with a participating medium: fog, dust, smoke or colored haze that light
scatters in and that dims what is behind it. Bylonder draws it as EEVEE does: the material's Volume shader (Principled
Volume, Volume Scatter, Volume Absorption, and the texture nodes that drive its density) runs in a grid of froxels
over the view, lit by the scene's lights through their shadows and by the world, and integrated toward the camera.
Light shafts are the sun or a spot shadowed by what stands in its way.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=volumes)

The demo, Temple Light, is made in Blender by a script (`volumes.py`): a temple hall at sunset, a low sun through its
tall windows, columns down the hall and an altar with two candles, all in one box of drifting dust.

## Steps

1. **Rendered shading.** Look through the camera (Numpad 0) and pick Rendered (Z > Rendered). Solid shows the dust's
   box; Rendered fills it with dust, which shows where the sun comes in.

   ![Solid, then Rendered shading](../media/features/volumes/shading.gif)

2. **The dust.** Select Dust, a box over the whole hall. Its material has no Surface: its Volume is a Principled Volume
   whose Density is a Noise Texture through a Map Range, a faint haze with thicker wisps.

   ![The Dust material in Properties > Material](../media/features/volumes/dust.png)

3. **Anisotropy.** The Principled Volume's Anisotropy sets which way the dust scatters light: above 0 forward, so the
   shafts glow most when you look toward the sun; below 0 back toward the light.

   ![Dragging the Anisotropy](../media/features/volumes/anisotropy.gif)

4. **The sun.** Select Sun and press R Z, then move the mouse: the shafts swing across the hall with the sun.

   ![Turning the sun about Z](../media/features/volumes/sun-rotate.gif)

5. **Cast Shadow.** The sun's Shadow panel: with Cast Shadow off, the walls stop no light and the whole hall glows;
   on, the windows and columns cut the light into shafts.

   ![Cast Shadow off and on](../media/features/volumes/cast-shadow.gif)

6. **Volumes settings.** Properties > Render > Volumes: Resolution is the froxels' size against the view's pixels and
   Steps their number in depth; Distribution moves the steps toward the camera. Bylonder reads them as EEVEE
   does, and they trade speed for detail: 1:16 and 32 steps for speed, 1:4 and 128 for detail (1:8 and 64 by
   default), as the Volumes panel (Bylonder icon) says.

   ![Properties > Render > Volumes](../media/features/volumes/settings.png)

   ![The Volumes panel's presets](../media/features/volumes/presets.png)

7. **Drifting dust.** The Dust box's location is keyed from the first frame to the last, and its noise moves with it:
   Play (Space) and the dust drifts through the shafts.

   ![Playing the frames](../media/features/volumes/play.gif)

8. **Render Image.** Render > Render Image (F12) renders through the camera at the output's resolution, its samples
   averaging the dust's slices smooth.

   ![Render > Render Image](../media/features/volumes/render-image.png)

## Project files

- [volumes.py](../../examples/volumes/volumes.py): builds the hall, its windows, columns and altar, the dust's volume
  and its drift, the sun and candles, and the camera, in Blender 5.2.
- [volumes.blend](../../examples/volumes/volumes.blend): the file the script saves.
- [index.js](../../examples/volumes/index.js): opens the .blend with Blender's reader.
- Recorded by [record-volumes.mjs](../../tools/docs/record-volumes.mjs).
