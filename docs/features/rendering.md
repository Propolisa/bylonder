---
id: rendering
title: Rendering
summary: Light a scene with Blender's lights and world and render it as EEVEE does, in Rendered shading and with Render Image, through Blender's camera.
expect: Lights, shadows, the world's color, glass and anti-aliasing render close to EEVEE from Blender's own settings; reflections and refraction see only the world, not the room around them.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/render/eevee/index.html
  - https://docs.blender.org/manual/en/5.2/render/lights/light_object.html
  - https://docs.blender.org/manual/en/5.2/render/eevee/world_settings.html
  - https://docs.blender.org/manual/en/5.2/render/eevee/render_settings/sampling.html
  - https://docs.blender.org/manual/en/5.2/editors/3dview/display/shading.html
  - https://docs.blender.org/manual/en/5.2/render/output/properties/format.html
example: rendering
thumbnail: rendering/thumbnail.png
media:
  - rendering/shading.gif
  - rendering/sun-rotate.gif
  - rendering/cast-shadow.gif
  - rendering/fill-power.gif
  - rendering/world.png
  - rendering/glass.png
  - rendering/samples.png
  - rendering/render-image.png
ui:
  - VIEW_3D
  - PROPERTIES
  - VIEW3D_PT_shading
  - DATA_PT_EEVEE_light*
  - DATA_PT_camera
  - EEVEE_MATERIAL_PT_surface
  - RENDER_PT_eevee_sampling*
  - RENDER_PT_format
  - RENDER_PT_color_management
  - TOPBAR_MT_render
operators:
  - view3d.toggle_shading
  - view3d.view_camera
  - render.render
  - render.view_show
code:
  - src/blenkernel/light/light-shadows.js
  - src/blenkernel/scene/world-babylon.js
  - src/blenkernel/scene/render-babylon.js
  - src/render/live.js
  - src/editors/render/host.js
tests:
  - tests/light-shadows.test.js
  - tests/render.test.js
  - tests/view-transform.test.js
  - tests/world-nodes-wasm.test.js
limits:
  - Shadows are filtered by a fixed amount, as EEVEE's filter radius; a point or spot light's Radius softens its shadows as the samples of a render or a still Rendered view add up (a moving view shows them hard), a sun's Angle softens its shadow with distance from the caster (Babylon's contact hardening filter, its samples set by Shadows > Rays), as a filtered estimate rather than EEVEE's traced rays.
  - Reflections and refraction show the world's color only; EEVEE's light probes (sphere, plane, volume) and screen space reflections are not drawn, so glass and metal do not reflect the room.
  - Screen-traced reflections (Raytracing with the Screen-Trace method) ignore a Principled BSDF's Specular IOR Level: a surface at Specular 0 still reflects as a plain dielectric does.
  - A world's node tree draws as the background and lights the scene through one world probe baked when the world changes, clamped at the world's Sun Threshold as EEVEE's, without the sun light EEVEE makes of what it clamps; a Sky Texture's Preetham and Hosek / Wilkie models, the world's Volume and its Background's blur are not drawn yet, and the tree's values are not followed while it is edited.
  - Volumes are not drawn: a material with only a Volume (a Principled Volume, say) shows nothing, as EEVEE shows no surface for it, and fog or smoke inside it is missing.
  - Glass refracts the world behind it, not the objects; a Transparent BSDF mixed in lets the objects through.
  - Khronos PBR Neutral's darkest tones (its toe) can differ from Blender's by up to three 8-bit steps; other view transforms and looks are within one in Rendered shading and Render Image, and within two or three in Solid and Material Preview.
  - The 3D Viewport's camera view frames tighter than the camera when the viewport's aspect differs from the render's; Render Image frames as Blender does.
---
# Rendering

Rendered shading and Render Image draw a scene from Blender's own data the way EEVEE does: Blender's lights with their
strength, color, soft size or angle (for highlights) and Cast Shadow, the world's color as light and reflection (EEVEE's world probe),
Blender's shader nodes for materials, and the film's anti-aliasing over the render's samples. The camera frames the
image through Blender's camera code (lens, sensor and fit), at the resolution in Properties > Output > Format.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=rendering)

The demo, Window Light, is made in Blender by a script (`rendering.py`): a table by a window, a sun through the panes,
a soft point light for fill, a dusk blue world, and glass, copper, glazed and wood materials.

## Steps

1. **Rendered shading.** Look through the camera (Numpad 0) and pick Rendered in the 3D Viewport's header (or Z >
   Rendered). The lights, shadows and materials draw as EEVEE would draw them.

   ![Solid, then Rendered shading](../media/features/rendering/shading.gif)

2. **The sun.** Select Sun and press R Z, then move the mouse: a sun's direction is all that places its light, so the
   window's pattern slides along the wall and the table. Its Strength, Color and Angle are in Properties > Light.

   ![Turning the sun about Z](../media/features/rendering/sun-rotate.gif)

3. **Cast Shadow.** The Shadow panel's checkbox turns the sun's shadows off and on. With it off, the light passes the
   wall and the window's pattern goes.

   ![Cast Shadow off and on](../media/features/rendering/cast-shadow.gif)

4. **A fill light.** Select Fill, a point light on the right. Its Power lifts the shadow side of the objects; its
   Radius of 0.8 m spreads its highlights.

   ![Dragging the fill light's Power](../media/features/rendering/fill-power.gif)

5. **The world.** Properties > World: the world's Color lights the scene from every side and is what glossy, metallic
   and glass surfaces reflect. Here a dusk blue fills the shadows and tints the copper.

   ![Properties > World](../media/features/rendering/world.png)

6. **Glass.** The carafe's material mixes a Glass BSDF with a Transparent BSDF by a Layer Weight's Fresnel: glass at
   the edges, clear where it faces the camera.

   ![The carafe's material](../media/features/rendering/glass.png)

7. **Samples.** Properties > Render > Sampling: Render samples are the jittered frames Render Image averages for its
   anti-aliasing and soft shadows; Viewport samples do the same for a still Rendered view.

   ![Properties > Render > Sampling](../media/features/rendering/samples.png)

8. **Render Image.** Render > Render Image (F12) renders through the scene camera at the output's resolution, in a
   Render Result window; Image > Save As saves it.

   ![Render > Render Image](../media/features/rendering/render-image.png)

## Project files

- [rendering.py](../../examples/rendering/rendering.py): builds the room, the objects, their materials, the lights,
  the world and the camera, in Blender 5.2.
- [rendering.blend](../../examples/rendering/rendering.blend): the file the script saves.
- [index.js](../../examples/rendering/index.js): opens the .blend with Blender's reader.
- Recorded by [record-rendering.mjs](../../tools/docs/record-rendering.mjs).
