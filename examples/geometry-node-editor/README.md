# Sunflowers

Sunflowers made in Blender 5.2 by `geometry-node-editor.py` (`blender -b --factory-startup -P geometry-node-editor.py`)
and opened here with Blender's own reader. Each head is a plain disc whose Geometry Nodes modifier adds its seeds and
petals.

- **Seeds.** Vogel's model: the n-th seed is turned by n times the Golden Angle and placed at sqrt(n) times Spacing from
  the middle, so every seed has the same area and the spirals of a real sunflower appear. Seeds grow and ripen toward
  the rim; the head domes.
- **Petals.** The same spiral at the rim, tilted up.
- **Inputs.** Properties > Modifiers shows Seeds, Golden Angle, Spacing and Petals. A Golden Angle a little off
  137.508 degrees breaks the pattern into straight arms.
- **Editing.** The Geometry Nodes workspace shows the group in the Geometry Node Editor, in its Seeds and Petals frames.
