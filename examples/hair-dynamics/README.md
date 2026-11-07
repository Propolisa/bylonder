# Sea Anemone

A sea anemone on a reef whose tentacles float and sway, simulated by Blender's Hair Dynamics, made in Blender 5.2 by
`hair-dynamics.py` (`blender -b --factory-startup -P hair-dynamics.py`) and opened here with Blender's own reader.

- **Tentacles.** A Curves object, as Add > Curve > Empty Hair makes it, with Essentials node groups as modifiers:
  Generate Hair Curves grows strands on the anemone's Disc vertex group, Hair Dynamics in Physics mode simulates them
  with its XPBD solver in a simulation zone, and Set Hair Curve Profile makes them thick at the root and thin at the
  tip.
- **Buoyancy.** Hair Dynamics' Gravity points up, gently, so the tentacles float; the anemone rocks with the current
  and they trail behind.
- **Playing.** Press Space. Jumping to a frame simulates up to it, as playing does.
- **Shading.** The Tentacle material reads Hair Info's Intercept through a color ramp, violet at the root to pale pink
  at the tip, and into the emission, so the tips glow. The world's Volume Scatter fogs the water.
