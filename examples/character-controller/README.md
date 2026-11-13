# Character Controller

Snow, Blender Studio's character rig, walking, jogging and sprinting on uneven ground, with motion from Quaternius'
Universal Animation Library retargeted onto its controls. Its character (`new Character(blend, 'RIG-Snow')`) plays its
actions by locomotion, keeps its feet on the ground and turns its head to what is near. Credits and licences are
in CREDITS.md.

- **Build.** `blender -b --factory-startup -P character-controller.py` downloads Snow (CC BY 4.0) and the library's
  Standard pack (CC0) into `downloads/`, checks them against their hashes and writes `character-controller.blend`. Neither
  the downloads nor the .blend are kept in git.
- **Retarget.** Each library bone drives one of Snow's FK controls by world rotation, through a bone at the control's
  rest added under it; the torso follows by location too. The library's rig is scaled by Snow's leg length over its own,
  so stride and bounce fit its legs. Controls that their own constraints place (toes, fingers) are left to the rig.
- **Clips.** Idle, Walk, Jog, Sprint, Talk and the jump's start, loop and landing, each baked onto the controls and kept
  on a muted NLA track, so File > Export > JavaScript with Animations set to Clips exports each as a clip. The stepping
  clips carry L and R pose markers where each of Snow's soles is lowest, which keep them in step when they blend.
- **Acting.** With the Snow Bar Scene pack (Blender Studio, CC BY, from Snow's character page; it needs a Blender
  Studio login), `blender -b --factory-startup -P character-controller.py -- <pack>/animation test/snow_bar_scene/snow_barscene.anim.blend`
  also adds its acting (animation by Rik Schutte) as the clip Acting, which the demo plays with the scene's dialogue
  (acting.mp3). The shot's 2022 rig poses its limbs through IK masters this rig lacks, so its body is baked onto this
  rig's FK controls.
- **Environment.** `environment.py` builds the ground the character examples share: a 60 m field of gently rolling terrain (about 0.4 m over waves 8 to 15 m long, level where the character starts and under the steps and slope) ringed by a rim of hills too steep to climb, with rocks and pines on it, a
  slope, five steps, three lanterns with Look Target empties, a soft sky and a warm sun. Its turf is a 512 px image
  the script generates (grass, mottling and flecks of earth that tile seamlessly), repeating every 2 m and shaded by a
  64 px variation image repeating every 29 m at an angle, so speed and direction read against it and the repeats do
  not show. About 240 grass tufts in patches are instances on a scatter mesh's faces (Instancing Faces), exported as
  thin instances; a few rocks, bushes and two pines come from Quaternius' Stylized Nature MegaKit (CC0), downloaded
  into `downloads/` and checked against its hash. Other scripts call it with
  `sys.path.insert(0, <this folder>); import environment; environment.build()`.
- **Textures.** Snow's images packed into the .blend: opaque color at most 2K as JPEG, the rest at most 1K as PNG.
