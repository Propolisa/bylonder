---
id: particle-hair
title: Particle Hair
summary: A hair particle system on a mesh, set up in Properties > Particles and shaped with the Comb brush in Particle Edit Mode, here the grass of a hill combed by the wind.
expect: Hair systems, children and Particle Edit Mode's brushes run Blender's code; hair UV and color attributes are not drawn.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/physics/particles/hair/index.html
  - https://docs.blender.org/manual/en/5.2/physics/particles/mode.html
  - https://docs.blender.org/manual/en/5.2/physics/particles/hair/children.html
example: particle-hair
thumbnail: particle-hair/thumbnail.png
media:
  - particle-hair/particles.png
  - particle-hair/particle-edit.gif
  - particle-hair/comb.gif
  - particle-hair/result.gif
ui:
  - VIEW_3D
  - PARTICLE_EDIT
  - PROPERTIES
  - VIEW3D_MT_particle*
  - PARTICLE_*
  - VIEW3D_PT_tools_particle*
operators:
  - object.mode_set
  - particle.brush_edit
  - particle.select_all
code:
  - src/draw/overlay-particle.js
  - src/editors/object/main-modes.js
  - src/editors/space_buttons/registry.js
tests:
  - tests/physics-wasm.test.js
limits:
  - Hair's UV and color attributes are not drawn.
  - Overlays of hair have no selection ids, clipping or Blender's line anti-aliasing.
  - In exported pages (File > Export > JavaScript) hair shows its strands as they were at export: simulated or animated strands stay still.
---
# Particle Hair

Blender's legacy hair is a particle system of type Hair on a mesh: strands grow from the emitter's faces or a vertex
group, children are interpolated around them, and Particle Edit Mode combs, cuts and grows the guide strands. The
system, its children and its edit mode are Blender's code in the module.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=particle-hair)

The demo is a grassy hill at sunset (`particle-hair.py`). Its grass is one hair system: 2,600 guide blades, eight
interpolated children each, thinning to the tip. The script combs every guide as the Comb brush would, bending it
downwind with a heading that wanders across the hill, so the grass shows the wind's path. In Blender the system starts
as Properties > Particles > + with Type set to Hair. The steps below look at the system and comb more wind into it.

## Steps

1. **The particle system.** Select Hill and open Properties > Particles. The Grass system lists its emission (number,
   hair length), children, roughness, and display settings.

   ![Properties > Particles on the Hill](../media/features/particle-hair/particles.png)

2. **Particle Edit Mode.** In the 3D Viewport header, open the mode menu and pick Particle Edit. The toolbar shows the
   brushes (Comb, Smooth, Add, Length, Puff, Cut, Weight) and the header the radius, strength and select mode.

   ![Mode menu > Particle Edit, from the top](../media/features/particle-hair/particle-edit.gif)

3. **Comb.** With the Comb brush, drag over the strands along the path the wind should take; the blades bend along
   the stroke and the children follow their guides. Each drag is one undo step.

   ![Three drags with the Comb brush](../media/features/particle-hair/comb.gif)

4. **See it rendered.** Back in Object Mode, Numpad 0 looks through the camera, and Rendered shading draws the blades
   as strips in the Grass material: Hair Info's Intercept through a color ramp, dark at the root and sun-bleached at the
   tip.

   ![The combed hill, rendered through the camera](../media/features/particle-hair/result.gif)

## Project files

- [particle-hair.py](../../examples/particle-hair/particle-hair.py): builds the hill, the hair system and its
  material, combs it, and adds the tree, sun and camera, in Blender 5.2.
- [particle-hair.blend](../../examples/particle-hair/particle-hair.blend): the file the script saves.
- [index.js](../../examples/particle-hair/index.js): opens the .blend with Blender's reader.
- Recorded by [record-particle-hair.mjs](../../tools/docs/record-particle-hair.mjs).
