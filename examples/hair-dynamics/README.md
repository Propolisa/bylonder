# Hair dynamics

Suzanne's hair falling and swinging as her head turns, simulated by Blender's Hair Dynamics, made in Blender 5.2 by
`hair-dynamics.py` (`blender -b --factory-startup -P hair-dynamics.py`) and opened here with Blender's own reader.

- **Hair.** A Curves object, as Add > Curve > Empty Hair makes it, with two Essentials node groups as modifiers:
  Generate Hair Curves grows strands on the head, and Hair Dynamics in Physics mode simulates them with its XPBD
  solver in a simulation zone, every frame from the start frame.
- **Playing.** Press Space. Jumping to a frame simulates up to it, as playing does.
- **Settings.** Properties > Modifiers shows both node groups' inputs: hair length, density and control points, and
  Hair Dynamics' solver, stiffness, damping and gravity.
- **Shading.** The Hair material reads Hair Info's Intercept through a color ramp into a Principled Hair BSDF.
