# Blender coverage notes

Hand-written notes for the Blender coverage view (Splash Screen > Blender Coverage). The view compares Blender's interface, extracted from Blender itself by `tools/blender-reference/surface.py`, with the Blender identifiers in Bylonder's source (see `scripts/blender-coverage.mjs`). This file only holds what the code cannot say: design decisions, equivalents and tips. Keep it sparse.

### Format

Each entry is a level-2 heading naming a node, followed by optional fields and free text:

    ## TOPBAR_MT_file > wm.save_mainfile
    Status: partial
    See: VIEW3D_MT_object > object.duplicate_move
    Text shown with the node.

- **Heading:** a path of ids or labels separated by `>`. The last segment names the node; earlier segments are any of its ancestors, in order, so a bare id (`object.delete`) matches it everywhere. Labels can repeat across editors (a panel and an editor are both called Text Editor), so prefer ids; an editor is named by its id, such as `TEXT_EDITOR` or `VIEW_3D`. Ending the heading with `> *` applies the entry to the whole subtree: its status counts for every node below it that is not implemented (`partial` also marks implemented ones), and the text shows as a callout on the subtree.
- **Status:** `done`, `partial`, `equivalent`, `replaced`, `planned`, `missing` or `skip` (not applicable, left out of the totals). Without one, the status comes from the code: done when implemented, equivalent when `See` points at an implemented node, missing otherwise.
- **See:** the node that provides the same functionality in Bylonder, as a heading-style path. Shown as a link.

## CONSOLE > *
Status: replaced
Bylonder projects are JavaScript. The browser console and the Code area replace the Python Console.

## TEXT_EDITOR > *
Status: replaced
The Code area (Monaco) edits the project's modules, with its own search, replace and shortcuts.

## INFO > *
Status: replaced
Reports appear as toasts and in the browser console.

## TOPBAR_MT_file > wm.save_mainfile
Status: partial
Save Version stores a version in the project history. There is no .blend file; projects live in browser storage and export as ZIP.

## TOPBAR_MT_file > wm.read_homefile
Status: partial
New Project creates a project from code. Blender's templates map to File > New from Example.

## PREFERENCES > *
Edit > Preferences holds Bylonder's own settings (Keep Scenes Loaded). Blender's sections follow as features need them.

## SEQUENCE_EDITOR > *
The Video Sequencer and File Browser are KubeezCut islands. Their Blender identifiers live in the KubeezCut fork, which this scan does not read yet.

## mesh.primitive_uv_sphere_add
Blender's operator builds it in the module, with Blender's positions and edges; its face and edge order differs from Blender's after the spin and merge it runs, which the primitive tests note.

## mesh.primitive_torus_add
Blender's own Python operator (`add_mesh_torus.py`, transpiled) builds the torus, and the module derives its edges as `mesh.update()` does.

## object.modifier_add
Blender's modifiers run Blender's own code in the module (`tools/blender-port/wasm/modifier-api.cc`) on the object's Mesh. Settings are stored by RNA identifier (`use_axis[1]`), described by Blender's RNA (`tools/blender-reference/modifiers.py`) and written at the DNA offsets `tools/blender-port/modifier_dna.py` reads from `rna_modifier.cc`. Types that need other objects, vertex groups, binding or simulation are not offered yet. Array (Nodes) stands for Blender's Array node group asset and goes after Blender's modifiers in the stack. The Add Modifier menu is Blender's (`properties_data_modifier.py`, transpiled), and each panel is laid out by its own `panel_draw` in the module (`tools/blender-port/wasm/panel-layout.cc` records the layout; JS draws it). Fields for vertex groups, objects and operators in those panels come later.

## Transform Modal Map > *
Typed values, the Global and Local cycling of repeated axis keys and the header text follow transform.cc. The scene orientation is always Global, so the second axis press is Local. Ctrl snaps to 1 unit in every view; Blender's orthographic axis views step the grid with zoom.
