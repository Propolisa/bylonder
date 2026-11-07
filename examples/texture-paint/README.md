# Texture Paint

Made in Blender 5.2 by `texture-paint.py` (`blender -b --factory-startup -P texture-paint.py`) and opened here with
Blender's own reader.

- **Vase.** A profile turned around Z with a cylindrical unwrap; its material's Image Texture (a 2048 x 1024 image
  painted in cobalt, packed into the file) feeds a glossy Principled BSDF's Base Color. Open the Texture Paint
  workspace to paint on it in the 3D Viewport or the Image Editor, or UV Editing to see and edit its UVs.
- **Dish.** A color attribute, glaze white with a cobalt rim, read by a Color Attribute node; Vertex Paint Mode shows
  and paints it.
- **Brushes.** Set to cobalt in the tool settings, with fine sizes for lines.
- **Table and wall.** A Wave Texture's grain through a Color Ramp, and plain plaster, in low window light.
