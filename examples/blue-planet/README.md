# Blue Planet

Made in Blender 5.2 by `blue-planet.py` (`blender -b --factory-startup -P blue-planet.py`) and opened here with
Blender's own reader. No image is used: every surface is shader nodes.

- **Planet.** A Noise Texture's height through Color Ramps for sea, shore, land, rock and ice caps, Bump for relief and
  Layer Weight for the blue rim.
- **Moon.** Voronoi craters through Bump over a grey Noise.
- **Sky.** A large sphere whose Voronoi points, through a narrow ramp into Emission, are the stars.
- **Editing.** Open the Shading workspace to see each material's nodes; Rendered shading through the camera shows the
  scene lit by the sun.
