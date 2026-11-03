# Grass Hill

A hill of grass at sunset made in Blender 5.2 by `particle-hair.py` (`blender -b --factory-startup -P particle-hair.py`)
and opened here with Blender's own reader.

- **Grass.** A hair particle system on the hill, with interpolated children, random roughness and blades thinning to
  the tip.
- **Wind.** The script combs every guide strand as Particle Edit's Comb brush would: each blade bends downwind, more
  toward its tip and more on the crest, the wind's heading wandering across the hill. The hair is saved as edited.
- **Combing.** Select the hill, switch the header's mode menu to Particle Edit and drag with the Comb brush; Blender's
  other brushes (Smooth, Add, Length, Puff, Cut, Weight) are in the toolbar.
- **Shading.** The Grass material reads Hair Info's Intercept through a color ramp, dark at the root and sun-bleached
  at the tip. A low warm sun lights the blades from behind.
