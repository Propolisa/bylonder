# Shape Keys

A jelly blob shaped by shape keys, made in Blender 5.2 by `shape-keys.py` (`blender -b --factory-startup -P
shape-keys.py`) and opened here with Blender's own reader.

- **Keys.** Basis, Squash, Stretch, Bulge (through the Top vertex group) and Wobble (muted), in Properties > Mesh >
  Shape Keys.
- **Animation.** Squash and Stretch are keyed on their values; play with Space and see their keys in the Dope Sheet.
- **Editing.** Select a key and press Tab to edit it in Edit Mode; Vertex > Blend from Shape mixes another key in.
- **Runtime.** The Shape Keys Runtime panel switches to Babylon (mapped): Babylon blends the keys on the GPU as morph
  targets.
