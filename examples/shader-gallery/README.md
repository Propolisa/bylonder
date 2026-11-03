# Shader Node Gallery

Twenty spheres, each with a material made of Blender's common shader nodes, and a floor with four objects casting the
sun's shadows on it, made in Blender 5.2 by `shader_gallery.py`
(`blender -b --factory-startup -P shader_gallery.py`) and opened here with Blender's own reader. The camera looks down
on them; Rendered shading and Render Image show them close to EEVEE (docs/features/shader-nodes.md lists the measured
differences).

- **Top two rows and a half.** Textures and converters shown through an Emission: Checker, Voronoi, Wave through a
  Color Ramp, Brick, Magic, a spherical Gradient through Mapping and Hue/Saturation/Value, the Geometry normal through
  Vector Math, Fresnel into a Mix, Layer Weight through Map Range into Combine Color, and White Noise through Invert and
  Brightness/Contrast.
- **The rest.** Shaders: Principled BSDF, Glossy BSDF, Diffuse and Glossy in a Mix Shader by Layer Weight, Diffuse plus
  Emission in an Add Shader, Sheen BSDF, a Diffuse BSDF with a Normal Map of a Wave Texture, a rough and a sharp
  Glossy BSDF mixed, Glass BSDF, Diffuse and Transparent mixed, and a metallic Principled BSDF.
- **The floor.** A cube, a ball, a pole and a ring cast the sun's shadows on a floor.
- **Editing.** Select a sphere and open the Shading workspace to see its nodes in the Shader Editor.
