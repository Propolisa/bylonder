---
id: particle-hair
title: Particle Hair
summary: A hair particle system on a mesh, shaped with the Comb brush in Particle Edit Mode and set up in Properties > Particles.
expect: Hair systems, children and Particle Edit Mode's brushes run Blender's code; hair UV and color attributes are not drawn.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/physics/particles/hair/index.html
  - https://docs.blender.org/manual/en/5.2/physics/particles/mode.html
  - https://docs.blender.org/manual/en/5.2/physics/particles/hair/children.html
example: hair
thumbnail: particle-hair/thumbnail.png
media:
  - particle-hair/particles.png
  - particle-hair/particle-edit.gif
  - particle-hair/comb.gif
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
---
# Particle Hair

Blender's legacy hair is a particle system of type Hair on a mesh: strands grow from the emitter's faces or a vertex
group, children are interpolated around them, and Particle Edit Mode combs, cuts and grows the guide strands. The
system, its children and its edit mode are Blender's code in the module.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=hair)

The demo, Combed Hair, is Suzanne with hair emitted from a scalp vertex group, combed back in Blender by a script
(`hair.py`). The steps below look at the system and comb it further.

## Steps

1. **The particle system.** Select Head and open Properties > Particles. The Hair system lists its emission (number,
   vertex group), hair length, children, and display settings.

   ![Properties > Particles on the Head](../media/features/particle-hair/particles.png)

2. **Particle Edit Mode.** In the 3D Viewport header, open the mode menu and pick Particle Edit. The toolbar shows the
   brushes (Comb, Smooth, Add, Length, Puff, Cut, Weight) and the header the radius, strength and select mode.

   ![Mode menu > Particle Edit](../media/features/particle-hair/particle-edit.gif)

3. **Comb.** With the Comb brush, drag over the strands. Each drag is one undo step.

   ![Three drags with the Comb brush](../media/features/particle-hair/comb.gif)

> **Tip** In Blender, a hair system starts as Properties > Particles > + with Type set to Hair on any mesh; the
> example's script does this and sets the vertex group, children and clumping.

## Project files

- [hair.py](../../examples/hair/hair.py): builds the head, the scalp group, the hair system and its material, and
  combs it, in Blender 5.2.
- [hair.blend](../../examples/hair/hair.blend): the file the script saves.
- [index.js](../../examples/hair/index.js): opens the .blend with Blender's reader.
- Recorded by [record-particle-hair.mjs](../../tools/docs/record-particle-hair.mjs).
