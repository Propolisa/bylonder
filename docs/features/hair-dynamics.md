---
id: hair-dynamics
title: Hair Dynamics
summary: Hair curves grown by Generate Hair Curves and simulated by Blender's Hair Dynamics node group in a simulation zone.
expect: The simulation matches Blender frame by frame; a jump to a far frame simulates every frame up to it, and the Shader Editor does not show the hair's material.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/modeling/geometry_nodes/simulation/hair_dynamics.html
  - https://docs.blender.org/manual/en/5.2/modeling/geometry_nodes/hair/generation/generate_hair_curves.html
  - https://docs.blender.org/manual/en/5.2/modeling/geometry_nodes/simulation/simulation_zone.html
example: hair-dynamics
thumbnail: hair-dynamics/thumbnail.png
media:
  - hair-dynamics/play.gif
  - hair-dynamics/generate.gif
  - hair-dynamics/gravity.gif
ui:
  - VIEW_3D
  - TIMELINE
  - PROPERTIES
  - OBJECT_MT_modifier_add*
  - DATA_PT_modifiers
  - DATA_PT_curves*
  - DATA_PT_CURVES*
  - CURVES_MT*
  - TIME_*
operators:
  - screen.animation_play
  - object.modifier_add
  - object.modifier_set_active
code:
  - src/blenkernel/main-view.js
  - src/draw/curves.js
  - src/modifiers/main-modifiers.js
  - tools/blender-port/wasm/modifier-api.cc
tests:
  - tests/hair-dynamics.test.js
  - tests/geometry-node-editor.test.js
limits:
  - The Shader Editor does not show a Curves object's material; the Hair material is read from the .blend and drawn.
  - Simulating to a far frame plays every frame from the start, which takes a moment on slow devices.
---
# Hair Dynamics

Blender 5's hair is a Curves object whose strands come from geometry node groups in its modifier stack. Generate Hair
Curves grows strands on a surface, and Hair Dynamics simulates them with an XPBD solver inside a simulation zone, one
step per frame. Both are Blender's Essentials node groups, evaluated by Blender's geometry nodes in the module, so the
strands match Blender 5.2's frame by frame (`tests/hair-dynamics.test.js`).

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=hair-dynamics)

The demo is a sea anemone on a reef (`hair-dynamics.py`): its tentacles are hair curves that sway as the anemone rocks
in the current. In Blender the setup is: select the anemone, Add > Curve > Empty Hair (which adds the Curves object
with Hair Dynamics), then Add Modifier > Hair > Generate Hair Curves above it, with the anemone as its Surface and its
Disc vertex group as the Density Mask. The script also adds Hair Curves Noise for waviness and Set Hair Curve Profile
for a radius from root to tip, sets Hair Dynamics to Physics, and turns its Gravity down to what water leaves of it.
The steps below play and change the simulation.

## Steps

1. **Play the simulation.** Press Space over the 3D Viewport (or the Timeline's play button). The simulation runs from
   the start frame, one solver step per frame, and the tentacles trail behind the anemone's motion; Space again stops
   it.

   ![Space plays the simulation from frame 1](../media/features/hair-dynamics/play.gif)

2. **Grow the strands.** Select Tentacles and open Properties > Modifiers. Generate Hair Curves has the Hair Length,
   Density and Control Points; a change grows the strands again and the simulation restarts from them.

   ![Hair Length 0.6 m, then 0.42 m](../media/features/hair-dynamics/generate.gif)

3. **Change the forces.** Hair Dynamics has the solver's substeps, stiffness, damping, collision and Gravity. A
   stronger downward gravity makes the tentacles droop over the rim; typing a frame in the Timeline simulates every
   frame up to it, so the result is the same as when played.

   ![Gravity Z -4, then -0.5, simulated to frame 60](../media/features/hair-dynamics/gravity.gif)

> **Tip** The Geometry Node Editor shows the node group of the active modifier: see
> [Geometry Node Editor](geometry-node-editor.md).

## Project files

- [hair-dynamics.py](../../examples/hair-dynamics/hair-dynamics.py): builds the reef in Blender 5.2: the anemone and
  its Disc group, the Tentacles object with its four modifiers and material, the rocking animation, lights, fog and
  camera.
- [hair-dynamics.blend](../../examples/hair-dynamics/hair-dynamics.blend): the file the script saves.
- Recorded by [record-hair-dynamics.mjs](../../tools/docs/record-hair-dynamics.mjs).
