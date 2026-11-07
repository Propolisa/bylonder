# Stress test: Rigify face rig

Rigify's Human meta-rig (with face) generated in Blender 5.2.3 by `rig.py`
(`blender -b --factory-startup -P rig.py -- face.blend`): 706 bones, 114 drivers, 533 constraints, 220 widget shapes,
bones only (no character mesh). Opened with File > Open in Bylonder at 5a5acc8 (`bylonder.png`).

- Opens in about 16 s; the control shapes draw in place through Blender's armature overlay.
- The viewport runs at 4 to 5 FPS with the rig.
- Every control shape draws black: no selection color, no Rigify bone colors.
- Page error: `BLF_svg_icon_bitmap` is missing from the module.
- Not checked yet: Pose Mode (the test script's keys did not reach the viewport), posing the face, Rigify's Generate
  inside Bylonder.
