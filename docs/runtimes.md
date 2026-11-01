# Runtimes

Which program runs a feature, Blender or Babylon, and which settings it reads. Decided 2026-11-01.

Bylonder holds every scene in Blender's Main and draws it with Babylon. Most features have one way to run: Blender's
code evaluates them and Babylon draws the result. Some features exist on both sides, as Blender data and as a Babylon
class: an armature and a Babylon `Skeleton`, a light and a Babylon light, a particle system and a Babylon particle system.
For these the user chooses the runtime. This page is the model every such feature follows.

## The three runtimes

A feature of one data block (one armature, one light) has a runtime, one of three:

| Runtime | Settings it reads | Runs it | Exact to Blender |
|---|---|---|---|
| **Blender** | Blender's | Blender's code in the module; Babylon draws the result | Yes |
| **Mapped** | Blender's, mapped to Babylon's class | Babylon | As far as the mapping goes; what it cannot map is listed |
| **Babylon** | Babylon's, edited as Blender settings | Babylon | No: Blender's settings for the feature are not used |

- **Blender** is the default for every data block, and the only runtime of features Babylon has no class for.
- **Mapped** keeps Blender's settings as the only truth: they stay editable and animatable as in Blender, and each
  change is mapped into the Babylon object as it happens. The mapping is the same code as File > Export > Babylon, so
  the view in Mapped and an exported file are the same. What Babylon cannot express (a B-Bone's segments, Preserve
  Volume) is a loss: it is listed, and the result differs from Blender's there.
- **Babylon** makes the Babylon object's own configuration the truth. Its settings are shown and edited in Blender's
  Properties editor as Bylonder settings, saved in the .blend with the data block and animatable like any property.
  Blender's settings for the feature stay in the file untouched but are not used: their panels show them inactive with a
  note saying the Babylon runtime ignores them.

## Rules

1. **One owner of settings at a time.** In Blender and Mapped, Blender's settings are the truth. In Babylon, Babylon's
   settings are the truth. Settings never sync both ways.
2. **Switching** is an undo step, like any edit.
   - Blender to Mapped, Mapped to Blender: nothing is converted. Only who runs the feature changes.
   - Blender or Mapped to Babylon: Babylon's settings start from the mapping of Blender's, once. Later edits to either
     side do not reach the other.
   - Babylon to Blender or Mapped: Blender's settings are used again as they were. Babylon's settings stay saved, so
     switching back to Babylon finds them unchanged.
3. **Editing stays Blender's.** Edit Mode, Pose Mode tools, selection and every Blender operator act on Blender's data
   in every runtime. While a data block is in Edit Mode it runs as Blender; on leaving, its runtime takes over again.
   In the Babylon runtime, operators that change settings the runtime ignores still change them, and the inactive
   panels show it.
4. **Losses are shown where the choice is made.** The runtime panel lists, for Mapped, every Blender setting the
   mapping cannot carry and what happens instead, and for Babylon, which Blender settings are ignored. Switching to a
   runtime with losses, and exporting a data block with losses, also reports them in the Info editor. No loss is silent.
5. **Export** writes Babylon objects. A data block in Blender or Mapped is exported through the mapping (its losses
   reported); one in Babylon is exported with its Babylon settings as they are.
6. **Files.** The runtime and Babylon's settings are custom properties of the data block (`bylonder_runtime`,
   `bylonder_babylon`), so a .blend keeps them and Blender itself opens the file unchanged, ignoring them.

## Where the choice is shown

- **The runtime panel** of each such feature, in its Properties tab (the Armature tab for an armature, the Light tab
  for a light): its header carries the Bylonder icon, and its first row is the runtime, Blender, Mapped or Babylon.
  Below it are Babylon's settings (with Mapped, the ones that have no Blender counterpart, such as a skeleton's bone
  influencers per vertex; with Babylon, all of them), then the losses.
- **Only where a choice exists.** A feature with one runtime shows no runtime row.

## The Bylonder icon

Bylonder's logo, small and in the icon color, marks what is Bylonder's and not Blender's, so a Blender user can tell
the two apart everywhere:

- panels, settings, menu entries, operators, modifiers, node types and editors Bylonder adds (its modifiers such as
  Array (Nodes), Babylon's blocks in a node Add menu, Babylon's node editors, File > Export > Babylon, the runtime
  panel);
- a feature running Mapped or Babylon, in the places that show what it is (its runtime panel, its Outliner row).

Blender's own UI carries no mark. An unmarked control behaves as in Blender 5.2.

## How a feature joins

A feature joins by one wrapper module of its own, without changing the code of other features or the code that runs
it as Blender:

- `src/runtimes/<feature>.js` registers the feature with `src/runtimes/runtimes.js`: the data type it wraps
  (`ARMATURE`), its mapping to Babylon (`map`, `update`, shared with export), its losses, its Babylon settings (a
  Blender PropertyGroup, for the runtime panel) and its Babylon runtime if it has one.
- `runtimes.js` is the only place the rest of Bylonder touches: the view (`main-view.js`) asks it, per data block,
  whether a runtime other than Blender draws that data block, and hands it over if so; export asks it for the mapping;
  the runtime panel is one add-on panel drawn from the registry. A data block in Blender runs exactly the code it runs
  today.

## Per feature

| Feature | Blender | Mapped | Babylon | Mapping |
|---|---|---|---|---|
| Armatures | Yes | Skeleton skinned on the GPU, posed from Main | Not yet | `src/io_scene_babylon/projections/` |
| Others | Yes | Not yet | Not yet | |

Each feature's page in `docs/features/` lists its mapping and its losses.
