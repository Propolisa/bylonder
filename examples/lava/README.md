# Lava sphere

The displaced lava sphere of [A displaced lava sphere](../../docs/lava-material.md), made in Blender 5.2 by `lava.py`
(`blender -b --factory-startup -P lava.py`) and opened here with Blender's own reader.

- **Sphere.** A UV Sphere with Subdivision Surface and a Displace modifier driven by a Clouds texture.
- **Lava.** Texture Coordinate's Object into two 4D Noise Textures. The first goes through a Color Ramp into
  Principled BSDF's Emission Color and Strength, the second through Bump into its Normal.
- **Editing.** Open the Shading workspace to see the nodes in the Shader Editor; Material Preview shows the result.
