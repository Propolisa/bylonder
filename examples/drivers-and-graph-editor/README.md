# Steam Engine

A small steam engine, made in Blender 5.2 by `drivers-and-graph-editor.py` (`blender -b --factory-startup -P
drivers-and-graph-editor.py`) and opened here with Blender's own reader.

- **Keys.** Only the flywheel is keyed: one turn between two linear keys, repeated by a Cycles modifier.
- **Drivers.** The crosshead, the piston rod, the connecting rod, the governor's spindle and its arms read the
  flywheel's angle; see them in the Drivers editor.
- **Noise.** The gauge's needle has one key and a Noise modifier on its curve.
