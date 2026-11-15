# Meditation

The mannequin seated cross-legged on a cushion in a bright earthen room, deep in thought, moving barely but
perceptibly, while low sun through an arched window and two round ports lays patches of light across the floor, the
curved walls and the figure. Everything is grey or off-white but a green turtle inlaid in the floor, the figure seated
on its shell.

- **Build.** `blender -b --factory-startup -P meditation.py` writes `meditation.blend` with its lightmaps baked by
  Cycles on the CPU (some minutes). `MEDITATION_BAKE=0` skips the bakes, `MEDITATION_SAMPLES` sets their samples and
  `MEDITATION_GPU=1` bakes on the GPU.
- **Motion.** The rig's action Meditation, 54 s that loop: breathing keyed over one breath of 4.5 s and repeated by
  Cycles modifiers (the chest and shoulders rise about 1 cm), sway and micro-shifts from Noise modifiers on the hips,
  spine, neck and head (each blended in and out over the loop, so it has no seam), and two slow settles of the head.
- **Light.** A Sun of 1 degree through the window and the ports. The room, the turtle, the cushion, the bench and the
  bowl carry lightmaps: a second UV map, Lightmap (Smart UV Project), and the light reaching them baked into an image
  (Diffuse, Color off), set as each object's Bylonder lightmap (Object properties > Lightmap) with Direct on. The
  figure's lightmap has Direct off: it holds the light he gives back of the sky and the room (Diffuse, Indirect, Color
  on), so the sun lights him live as he breathes.
- **Credits.** CREDITS.md: the mannequin is Quaternius' (CC0).
