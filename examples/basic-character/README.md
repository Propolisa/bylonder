# Basic Character

A Mixamo-style character, the basic path of the character animation guide (docs/character-animation.md, example 1):
an armature named Armature with baked actions Idle, Walk, Run and Jump, without markers, root motion or IK controls.
The mannequin and its motion are from Quaternius' Universal Animation Library (CC0); credits are in CREDITS.md.

- **Build.** `blender -b --factory-startup -P basic-character.py` downloads the library's Standard pack into
  `downloads/`, checks it against its hash and writes `basic-character.blend`.
- **Actions.** Idle, Walk and Run (the library's jog) as they come; Jump is the library's start, half a second of its
  airborne loop and its landing in one action, as a Mixamo download has it. Each is on a muted NLA track, so
  File > Export > JavaScript with Animations set to Clips exports it as a clip; Idle is also the active action.
- **Scene.** The armature at the origin facing -Y, on the character examples' shared ground (`../character-controller/environment.py`: rolling terrain, a slope, steps, lanterns, grass, rocks and trees), with a camera behind it.
