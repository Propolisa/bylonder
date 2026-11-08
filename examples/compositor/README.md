# Neon Night

A noodle bar's neon sign in a wet alley at night, made in Blender 5.2 by `compositor.py` (`blender -b --factory-startup
-P compositor.py`) and opened here with Blender's own reader.

- **Sign.** Text objects in Sacramento and Poiret One (in `fonts/`, SIL Open Font License, loaded by the script) with
  a negative Offset and a round Bevel, so each stroke is a glass tube, converted to meshes; a bowl, chopsticks and
  steam drawn as beveled curves; all in emissive materials on a dark backplate with standoffs.
- **Alley.** A brick wall (Brick Texture over object coordinates) with the window and the door cut out by Boolean, warm
  emissive planes behind them, a silhouette behind raised blinds, crates, a bicycle, pipes, cables and rain streaks.
- **Street.** Wet asphalt and puddles: flat faces in a dark Principled material with Roughness 0.02 that mirror the
  sign when Raytracing is on.
- **Compositor.** Render Layers, Glare (Fog Glow), Lens Distortion with a little Dispersion, a Color Balance grade and
  a vignette (an Ellipse Mask, blurred, multiplied over the image) into the Group Output; a Viewer shows the result.
- **Render.** Render > Render Image composites the render with Blender's own compositor.
