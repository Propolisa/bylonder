# Combed hair

Suzanne with a head of combed hair, made in Blender 5.2 by `hair.py` (`blender -b --factory-startup -P hair.py`) and
opened here with Blender's own reader.

- **Hair.** A hair particle system emitted from the scalp vertex group, with interpolated children, clumping and a
  thinning tip. Its strands were combed back and down in Particle Edit Mode and saved as edited hair.
- **Combing.** Select the head, switch the header's mode menu to Particle Edit and drag with the Comb brush. The
  toolbar has Blender's other brushes (Smooth, Add, Length, Puff, Cut, Weight); the header sets the brush radius and
  strength and the select mode (Path, Point, Tip).
- **Shading.** The Hair material reads Hair Info's Intercept through a color ramp, dark at the root and lighter at
  the tip, into a Principled Hair BSDF. Material Preview and Rendered shade each strand as a cylinder, as EEVEE does.
  Properties > Render > Curves sets the strand shape (Strand, Strip, Cylinder) and its subdivision.

Open Properties > Particles to change the count, length, children and display.
