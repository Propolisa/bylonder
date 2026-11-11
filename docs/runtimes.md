# Runtimes

Which settings define a feature and which code evaluates it, when Blender and Babylon both can. Decided 2026-11-01.

## Terms

Bylonder keeps every scene in Blender's Main and draws it with Babylon. For any feature, three things happen:

- **Settings** define it: Blender's (the Armature tab, the Light tab) or, where offered, Babylon's own.
- **Evaluation** computes its result from its settings and the frame: a deformed mesh, a simulated particle, a posed
  skeleton. Blender's code does it in the module, or Babylon's code does it in the page.
- **Drawing** is always Babylon's. What Babylon draws comes from a mapping of the evaluated result into Babylon's
  objects (a Principled BSDF drawn as a PBR material, a light as a Babylon light).

Most features have Blender settings and Blender evaluation only. A feature that Babylon also has as a class of its own
(an armature and a `Skeleton`, a particle system and a `ParticleSystem`, a light and a Babylon light) can offer a
choice. That choice is its runtime.

## The three runtimes

| Runtime | Settings | Evaluation | Matches desktop Blender |
|---|---|---|---|
| **Blender** | Blender's | Blender's | Yes |
| **Babylon (mapped)** | Blender's | Babylon's, from Blender's settings mapped to Babylon's class | Except its listed approximations |
| **Babylon (native)** | Babylon's, edited as Bylonder settings | Babylon's | No |

A feature offers only the runtimes that differ for it:

- **Babylon (mapped)** only where Babylon evaluates something Blender would otherwise evaluate (deforming,
  simulating). A light is not evaluated, so a light does not offer it.
- **Babylon (native)** only where Babylon's settings are a complete alternative to Blender's for the same thing (a
  light's units, falloff and shadow generator). Structure that Blender's editors edit (geometry, bones, curves) is
  always Blender's, so an armature does not offer it.

Blender is the default everywhere, and the only runtime of features that offer no choice.

## Rules

1. **One owner of settings at a time.** With Blender and Babylon (mapped), Blender's settings are the truth. With
   Babylon (native), Babylon's settings are the truth. Settings never sync both ways.
2. **Switching** is an undo step.
   - Between Blender and Babylon (mapped): nothing is converted; only who evaluates changes.
   - To Babylon (native): Babylon's settings start from the mapping of Blender's, once. After that neither side
     changes the other.
   - From Babylon (native) back: Blender's settings are used as they were. Babylon's settings stay saved, so switching
     to native again finds them unchanged.
3. **Editing is always Blender's.** Edit Mode, Pose Mode, Weight Paint, selection and every operator act on Blender's
   data in every runtime. While its object is in Edit Mode a feature evaluates as Blender; on leaving, its runtime takes
   over again.
4. **One animation system.** Blender's animation system animates everything in the editor, Babylon (native) settings
   included (they are properties, keyed with I like any other). Babylon animations are made only by export.
5. **Approximations and fallbacks are always shown.** Mapping a Blender setting Babylon cannot express exactly is either:
   - an **approximation**: Babylon evaluates something close (Preserve Volume of scaled bones), listed with what
     differs; or
   - a **fallback**: Babylon cannot evaluate that part at all (a Subdivision Surface after the Armature modifier), so
     that part evaluates as Blender, listed with the reason.

   Both are listed in the runtime panel and reported to the Info editor on switching and on export. Nothing wrong is
   ever drawn silently.
6. **Export** writes Babylon objects. A feature in Blender or Babylon (mapped) is exported through the mapping, with its
   approximations reported (a fallback part is exported as its evaluated result, baked). A feature in Babylon (native)
   is exported with its Babylon settings. Babylon (mapped) is therefore a live preview of the export.
   File > Export's Runtime setting can choose one runtime for the package, a feature or an instance instead of each
   instance's own (`runtimes.js` `chosenRuntime`); a choice a feature does not offer or does not export yet is reported to
   the Info editor, and the instance exports with its own.
7. **Files.** The runtime and Babylon's settings are saved in the .blend on the struct that holds the feature (custom
   properties under `bylonder`), so desktop Blender opens the file unchanged and evaluates it as Blender.

## Where the choice lives

On the struct Blender keeps the feature's evaluated state in, so each instance chooses:

- an armature's on its **Object** (the pose is the object's; two objects sharing one Armature data choose separately),
  with the meshes it deforms following it;
- a light's on its **Light** data;
- a particle system's on its **ParticleSettings**.
- an image's sampling on its **Image** (its panel is in the Image Editor's sidebar, which shows the Image).
- a mesh's shape keys on its **Key** (the keys' values are the Key's; objects sharing the Mesh choose together).

For scripts and tools the path is `<struct>.bylonder.runtime` (`'BLENDER'`, `'MAPPED'`, `'NATIVE'`),
`<struct>.bylonder.babylon` (the native settings) and `<struct>.bylonder.issues` (read only: each approximation or
fallback with its kind, the setting it concerns and a message).

## What the user sees

- **The runtime panel** in the feature's Properties tab (Armature, Light, Particles), shown only when the feature offers
  a choice. Its header carries the Bylonder icon. Its first row is the runtime; then Babylon's settings (with mapped,
  only those Blender has no counterpart for, such as a skeleton's influencers per vertex; with native, all of them);
  then the approximations and fallbacks.
- **Inactive Blender settings.** With Babylon (native), the Blender panels whose settings are not used are drawn
  inactive with a one-line note naming the runtime.
- **What runs where.** The Outliner marks objects and data with a feature not on Blender with the Bylonder icon, and
  the Scene tab's Runtimes panel lists every such feature with its runtime and issue count, each a link to its panel.

## The Bylonder icon

Bylonder's logo, small and in the icon color, marks what is Bylonder's and not Blender's: panels, settings, menu
entries, operators, modifiers, node types and editors Bylonder adds (Array (Nodes), Babylon's blocks in a node Add menu,
Babylon's node editors, File > Export > Babylon, the runtime panels), and features running on Babylon. Blender's own UI
carries no mark: an unmarked control behaves as in Blender 5.2.

## Scenarios

- **GPU skinning for a game.** A rigged character is slow to deform on the CPU. Select the rig, Armature tab, Runtime:
  Babylon (mapped). The pose and the deformation look the same, Preserve Volume included (dual quaternion skinning).
  Exporting gives the same skeleton and skinning.
- **A modifier after Armature.** The body has Subdivision Surface after its Armature modifier. In Babylon (mapped) the
  panel lists a fallback: the body deforms in Blender; other meshes of the rig still skin in Babylon.
- **Editing.** In Edit Mode the rig evaluates as Blender; back in Pose Mode, Babylon skins again. Weight painting the
  body changes Blender's vertex groups, which the mapping follows.
- **Playing an action.** Blender's animation system poses the rig each frame; with mapped, Babylon skins that pose.
- **Babylon light units.** A light needs Babylon's intensity and shadow settings. Light tab, Runtime: Babylon (native).
  Babylon's settings start from Blender's Power and color; Blender's Light panel goes inactive. Keying the Babylon
  intensity works as any key. Switching back to Blender restores Blender's Power as it was.
- **Desktop Blender.** The .blend opens in Blender with every feature as Blender.
- **A script.** `bpy.context.object.bylonder.runtime = 'MAPPED'`, then `object.bylonder.issues` lists what differs.

## Features and runtimes

| Feature | Lives on | Blender | Babylon (mapped) | Babylon (native) |
|---|---|---|---|---|
| Armature deform | Object | Yes | Skeleton, GPU skinning | Not offered |
| Shape keys | Key | Yes | MorphTargetManager, GPU blending | Not offered |
| Light | Light | Yes | Not offered | Planned |
| Particle system | ParticleSettings | Yes | Planned | Planned |
| Image sampling | Image (Image Editor > Sidebar > Image) | Yes | Not offered | Anisotropic filtering, mipmaps |

Bylonder-only features (Babylon particle systems, Array (Nodes), Babylon node blocks in material graphs) have no
Blender counterpart: they are not runtimes, and carry the Bylonder icon.

## How a feature joins

One wrapper module per feature, without changing the code of other features or the code that evaluates it as Blender:

- `src/runtimes/<feature>.js` registers with `src/runtimes/runtimes.js`: the struct it lives on, the runtimes it
  offers, its mapping (`map`, `update`, shared with export), its issues, its native settings (a PropertyGroup) and its
  native evaluation if offered.
- `runtimes.js` is the only place the rest of Bylonder touches: the view (`main-view.js`) asks it whether a runtime
  other than Blender evaluates a struct and hands it over if so; export asks it for the mapping; the runtime panels, the
  Scene tab's Runtimes panel and the Outliner mark come from the registry. A feature in Blender runs exactly the code it
  runs today.

## Implementation

- **Registry.** `src/runtimes/runtimes.js`: `registerRuntime(feature)`, `runtimeOf(struct)`, `featureOf(struct)`. The
  view's hooks are two calls in `main-view.js` `drawEvaluated`: `evaluates(entry)` (whether a runtime other than Blender
  evaluates an object's geometry, so the view does not draw Main's evaluated mesh for it) and `evaluated(view)` after
  each evaluation (`view`: the scene, Main, the objects' entries, `drawGeometry`, `drawMesh`). A struct whose runtime
  changed since the last evaluation reports its issues to the Info editor (`wm-reports.js` `report`). Export calls
  `exportRuntimes(world)` (`babylon-export.js` `serializeScene`, `js-export.js` `exportModule`).
- **Properties.** `registerRuntimeTypes(icon)` (called by `main.js` once Blender's Python is loaded) registers, per
  struct the features live on, `BYLONDER_PG_<struct>` (`runtime`, an enum of the runtimes those features offer, not
  animatable; `babylon`, a `BYLONDER_PG_<struct>_babylon` of their Babylon-only settings; `issues`, read only) and
  assigns it as `<struct>.bylonder`, as an add-on assigns a `PointerProperty`. Blender stores it as ID properties, so
  it saves in the .blend and undoes with Main's memfile steps.
- **Panels.** `<CONTEXT>_PT_bylonder_<feature>_runtime` per feature (`DATA_PT_bylonder_armature_runtime` for armatures) and
  `SCENE_PT_bylonder_runtimes` are `bpy.types.Panel` classes registered into the module, so Blender's Properties editor
  lays them out like its own panels. Issues are listed under Approximated (`INFO` icon) and Evaluated as Blender
  (`ERROR` icon). The Blender Coverage scan leaves out ids with `bylonder` in them, which are not Blender's.
- **The Bylonder icon** is a custom icon of Blender's icon system (`python/bpy_icons.js` `bylonderIcon`, a layout's
  `icon_value`); the layout renderer draws it as the monochrome `BYLONDER` icon (`public/logo/bylonder-20.svg`).

## Armature deform

`src/runtimes/armature.js`. With Babylon (mapped) on an armature object not in Edit Mode:

- **Skeleton.** A Babylon `Skeleton` named after the armature object, one `Bone` per Blender bone (parents first, the
  bone's name, id `<skeleton> <bone>`), its rest and bind matrices from the bones' `matrix_local`, its local matrix from
  the pose bones' evaluated `matrix`, both in Blender's axes mapped as `blender-boundary.md` Decision 2 says. A root
  bone's matrices include the armature-to-mesh matrix, so meshes placed differently from the armature get a skeleton
  each (named `<armature> <mesh>`).
- **Skin.** Each mesh object with an Armature modifier on it is drawn from its Mesh as Main holds it, with
  `matricesIndices` and `matricesWeights` per Babylon vertex (face corner) from its vertex groups: the groups of
  deforming bones, normalized by their sum as `armature_deform.cc` does, the modifier's vertex group (inverted or not)
  scaling the deform, the rest of the weight on the identity matrix Babylon's skeletons end with, so unweighted vertices
  stay in place. Influencers per vertex are the `influencers` setting: Automatic (4, or 8 with Babylon's extra buffers
  when a vertex has more), 4 or 8.
- **Pose.** Blender poses the bones in every runtime (its animation system, constraints, IK, drivers and Pose Mode
  tools), so constraints and every bone setting that changes the pose (scale inheritance included) are exact: IK is
  not mapped to Babylon's `BoneIKController`, which would only approximate Blender's solver. After
  each evaluation the bones' local matrices are set from Main's pose and Babylon skins on the GPU. The skinned mesh's
  bounds and picking positions follow the pose (skinned on the CPU when the pose changes, from its bones' boxes while
  the animation plays).
- **Exact.** Babylon's skinning gives Main's evaluated positions to float precision (checked at three poses and two
  frames of an action, `tests/runtimes-armature-wasm.test.js`). A deforming B-Bone's segment joints are bones of the
  skeleton (B-Bone Segments as Bones, on by default): their matrices are Blender's (`PoseBone.bbone_segment_matrix`),
  and each vertex's weight on the B-Bone is split between two joints as Blender places it (`bbone_segment_index`).
  Preserve Volume skins with dual quaternions (Dual Quaternion Skinning, on by default;
  `runtime/dual-quaternion-skinning.js`, a material plugin for PBR and Standard materials and a bones block for node
  materials): Main's deform to float precision for bones that rotate and move.
- **Approximations:** normals (Babylon skins them with the bones; Blender recomputes them from the deformed shape, so
  shading differs a little where bones blend: listed for every skinned mesh), Preserve Volume of scaled bones (dual
  quaternions blend their scale linearly, Blender otherwise) or with Dual Quaternion Skinning off (skinned linearly), bone envelopes
  (`use_bone_envelopes`: they do not deform), a deforming bone's B-Bone segments where shape keys move a vertex (it
  keeps the segment of its Basis shape) or with B-Bone Segments as Bones off (it deforms as one segment), its
  Multiply Vertex Group by Envelope, and vertices with more weights than the influencers (the strongest kept,
  normalized).
- **Fallbacks**, per mesh (the mesh deforms as Blender; the rig's other meshes still skin in Babylon): a modifier before
  or after the Armature modifier, more than one Armature modifier, Multi Modifier, shape keys, Bylonder's own modifiers
  after Blender's, and a mesh whose geometry is Babylon's own. A mesh in Edit or Sculpt Mode deforms as Blender while it
  is edited, without an issue.
- **Export.** File > Export > Babylon writes the skeletons, the skinned meshes and one matrix animation per bone
  (`_matrix`, in the scene's animation group), sampled from Main at every frame of the scene range when the armature
  is animated (an action, drivers or constraints), else its pose at the current frame. An armature on Blender is mapped
  for the export's duration. Babylon's loader skins the file as Main deforms it at each frame; Babylon interpolates
  matrix keys between frames only with `Animation.AllowMatricesInterpolation`. Babylon's serializer leaves out the extra
  four influences of a shared geometry, so such a mesh is written with its own geometry.

When Babylon (mapped) is preferable: GPU skinning keeps the deformed mesh off the CPU-to-GPU upload every frame, and
the view is what the exported file shows. Until the module skips the Armature modifier in Main's evaluation of a mapped
mesh, Blender still deforms it on the CPU as well.

Not yet: the Outliner mark; the Scene tab's rows as links to their panels; a module export
that skips the Armature modifier of a mapped mesh, and one that gives the mesh evaluated before it (so modifiers before
the Armature modifier stop being fallbacks). Shape keys before it are not: Babylon morphs a mesh, then skins it, as
Blender deforms after the keys, when its shape keys are on Babylon (mapped) too; on Blender they make the mesh a
fallback in the view.

## Shape keys

`src/runtimes/shape-keys.js`. With Babylon (mapped) on a mesh's Key, for each object of that Mesh in Object Mode:

- **Targets.** The object is drawn from its Mesh as Main holds it, and a `MorphTargetManager` holds one target per key
  but Basis: per Babylon vertex (face corner) Basis plus the key's offset from its relative key, scaled by the key's
  vertex group as `key.cc` `key_evaluate_relative_float3` scales it, with the key's own normals (`normals_split_get`,
  or its face and vertex normals as the mesh draws them).
- **Influence.** After each evaluation each target's influence is its key's value, 0 when muted; with the object's
  shape pinned (`show_only_shape_key`) the active key's is 1 and the others' 0. Nothing else changes per frame: the
  targets are made again only when the Mesh alone was tagged (an edit of its weights or attributes) or the keys'
  structure or coordinates changed (compared with copies). The bounds grow by each target's offset box at its
  influence.
- **Exact.** The blended positions are Main's evaluated positions to float precision
  (`tests/shape-keys-wasm.test.js`).
- **Approximation:** normals (Babylon blends the keys' normals linearly; Blender recomputes them from the blended
  positions).
- **Fallbacks:** absolute keys (Relative off), a modifier shown in the viewport (the keys come first in Blender's stack),
  Bylonder's own modifiers, a Mesh whose positions differ from Basis, a pinned key relative to a key other than Basis,
  and a mesh whose geometry is Babylon's own. Edit and Sculpt Mode evaluate as Blender while editing.
- **Settings** Blender has none for: Morph Normals (`enableNormalMorphing`) and Targets in Texture
  (`useTextureToStoreTargets`).
- **Export.** File > Export > Babylon writes the targets and, when the Key is animated, one `influence` animation per
  target sampled at every frame of the scene range. A Key on Blender is mapped for the export's duration.

As with armatures, Blender's depsgraph still evaluates the keys into the mesh on the CPU; the saving is the mesh's
extraction and upload each frame (`bench/shape-keys.bench.js`: 16 ms against 4 ms a frame on 32k vertices).
