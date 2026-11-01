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
   - an **approximation**: Babylon evaluates something close (Preserve Volume skinned linearly), listed with what
     differs; or
   - a **fallback**: Babylon cannot evaluate that part at all (a Subdivision Surface after the Armature modifier), so
     that part evaluates as Blender, listed with the reason.

   Both are listed in the runtime panel and reported to the Info editor on switching and on export. Nothing wrong is
   ever drawn silently.
6. **Export** writes Babylon objects. A feature in Blender or Babylon (mapped) is exported through the mapping, with its
   approximations reported (a fallback part is exported as its evaluated result, baked). A feature in Babylon (native)
   is exported with its Babylon settings. Babylon (mapped) is therefore a live preview of the export.
7. **Files.** The runtime and Babylon's settings are saved in the .blend on the struct that holds the feature (custom
   properties under `bylonder`), so desktop Blender opens the file unchanged and evaluates it as Blender.

## Where the choice lives

On the struct Blender keeps the feature's evaluated state in, so each instance chooses:

- an armature's on its **Object** (the pose is the object's; two objects sharing one Armature data choose separately),
  with the meshes it deforms following it;
- a light's on its **Light** data;
- a particle system's on its **ParticleSettings**.

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
  Babylon (mapped). The pose and the deformation look the same; the panel lists Preserve Volume as an approximation if
  the body uses it. Exporting gives the same skeleton and skinning.
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
| Light | Light | Yes | Not offered | Planned |
| Particle system | ParticleSettings | Yes | Planned | Planned |

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
