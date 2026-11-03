# Koi Pond

Two koi under lily pads, made in Blender 5.2 by `vertex-and-weight-paint.py` (`blender -b --factory-startup -P
vertex-and-weight-paint.py`) and opened here with Blender's own reader.

- **Markings.** Each fish's Markings color attribute, read by its material's Color Attribute node; paint it in Vertex
  Paint.
- **Tail.** The Tail vertex group, 0 at the head to 1 at the tail; paint it in Weight Paint. A Simple Deform (Bend)
  limited to it swings the tail, its angle keyed both ways and repeated by a Cycles modifier.
