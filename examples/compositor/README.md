# Neon Night

A noodle bar's neon sign on a brick wall over a wet street, made in Blender 5.2 by `compositor.py` (`blender -b
--factory-startup -P compositor.py`) and opened here with Blender's own reader.

- **Scene.** Text objects and beveled curves in emissive materials, a brick wall, a street whose Noise Texture leaves
  glossy puddles, and point lights in the tubes' colors.
- **Compositor.** Render Layers, Glare (Fog Glow), Lens Distortion with a little Dispersion, a Color Balance grade and
  a vignette (an Ellipse Mask, blurred, multiplied over the image) into the Group Output; a Viewer shows the result.
- **Render.** Render > Render Image composites the render with Blender's own compositor.
