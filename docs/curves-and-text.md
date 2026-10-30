# Curves and text

Blender's Curve and Text objects (`OB_CURVES_LEGACY`, `OB_FONT`) in Bylonder: Blender's own C++ for the data, its evaluation, Edit Mode and text layout, in the module (`src/bmesh/bmesh.wasm`). Decided 2026-10-28.

## Data

- A curve or text object is a Babylon mesh whose geometry is the mesh Blender evaluates for it. Its Curve data is held in RNA's terms in the object's creation recipe (`metadata.wbCreation.curve`), like a mesh's Mesh data, so undo, saving and duplicating carry it: settings by RNA identifier (`bevel_depth`, `align_x`), splines with their points (`co`, `handle_left`, `handle_left_type`, `select_control_point`), the text with its character formats, text boxes and fonts, and the objects it follows by name (`follow_curve`, `bevel_object`, `taper_object`). See `src/blenkernel/curve/curve.js`.
- In the module the data is a Curve ID in the shared Main (`main_object_add` with `OB_CURVES_LEGACY` or `OB_FONT`, as `BKE_curve_add` makes it). Settings are written at their DNA offsets, which `tools/blender-port/modifier_dna.py SRC curves` reads from `rna_curve.cc` with Clang (`src/makesrna/dna-curves.json`), and described by Blender's RNA (`tools/blender-reference/curves.py`, `rna-curves.json`). Splines and text cross through `tools/blender-port/wasm/curve-api.cc`.
- RNA: `Curve`, `TextCurve`, `Spline`, `BezierSplinePoint`, `SplinePoint`, `TextCharacterFormat`, `TextBox` and `VectorFont` are bound over this data (`src/makesrna/rna-curve.js`); a write re-evaluates the object, or changes the edit data in Edit Mode.

## Evaluation

- Main's depsgraph evaluates a curve or text object (`BKE_displist_make_curveTypes`): text through `BKE_vfont_to_curve` (layout, size, shear, spacing, alignment, text boxes and overflow, offset, underline, small caps, kerning), deform modifiers on the control points, tessellation, bevel, extrude, taper, profile, fill and twist, then the other modifiers on the mesh. A filled, extruded or beveled curve gives a mesh; otherwise the wire of its evaluated curves (`curve_to_wire_mesh`, as Object > Convert makes it), which Bylonder draws as loose edges.
- The objects a curve follows are its pointers in Main (`main-sync.js` `pushCurve`), so the depsgraph evaluates them first and a change to one evaluates its followers again. The view draws the result (`main-view.js`).
- Text along a path: `follow_curve` (Blender's text on a curve) and the Curve modifier (`MOD_curve.cc`, deforming the text's points before tessellation) both run Blender's code.

## Fonts

- FreeType 2.13.3 (Blender's pinned version) is built into the module as a private dependency: only `blenfont` sees its headers, so the rest of the build stays cached. Blender's `blenfont` is built headless (`WITH_HEADLESS`): glyph outlines (`BLF_character_to_curves`) without drawing.
- The built-in font is Blender's `bfont.pfb`, embedded as Blender's datatoc embeds it (`datatoc_bfont_pfb`, fetched at the manifest's tag into the build, outside the source tree) and registered with `BKE_vfont_builtin_register` when types are set up. `G_MAIN` is the module's Main, where `BKE_vfont_builtin_ensure` keeps it.
- Other TrueType, OpenType and Type 1 fonts are a file's bytes packed into a VFont (`curve_vfont_new`, `loadFont` in `curve.js`).

## Edit Mode

- Tab on a curve or text object enters Edit Mode on Main's own object through `editors/curve/editcurve.js`: `ED_curve_editnurb_make` or `ED_curve_editfont_make`, and back with `ED_curve_editnurb_load` or `ED_curve_editfont_load`. Main's depsgraph evaluates the edit data, which the view draws; every change is read back as the page's record of the object and is an undo step.
- Every `curve.*` and `font.*` operator the module has is registered by idname and runs by its exec, so Blender's menus (`VIEW3D_MT_edit_curve`, `_ctrlpoints`, `_segments`, `_delete`, `VIEW3D_MT_edit_font`, `VIEW3D_MT_select_edit_curve`, `VIEW3D_MT_select_edit_text`, `VIEW3D_MT_curve_add`) and the `Curve` and `Font` keymaps run them: E extrude, V handle types, Alt C cyclic, X delete, subdivide, A, Alt A, Ctrl I; in text, arrows, Shift arrows, Backspace, Delete, Enter, Ctrl B, I, U, P. A typed character is `font.text_insert`, as Blender's text input event.
- Picking is Blender's `ED_curve_editnurb_select_pick` in a 3D View region given the view's size and matrices (`view3d_region_*` in `curve-api.cc`, with Blender's `view3d_project.cc` and `view3d_iterators.cc`).
- G, R and S use Bylonder's modal transform for input; each step restores the edit data as it was when the transform began and runs Blender's `transform.translate`, `transform.rotate` or `transform.resize` with the step's values, so `transform_convert_curve.cc` moves points and handles and tests handle types as in Blender.
- The overlay (`src/draw/overlay-edit-curve.js`, `overlay-edit-text.js`) draws handles in their type's theme colors, the lines between NURBS and poly points, the points, and for text the cursor and selection where Blender's layout put them.
- Adding: Object Mode's Add > Curve and Add > Text make a new object whose Curve Blender's own primitive operator fills (`ED_curve_add_nurbs_primitive`), as `curvesurf_prim_add` does for a new object; in Edit Curve mode the primitive joins the edit object.

## Tests

`tools/blender-reference/curve-fixtures.py` runs Blender 5.2.3 on 56 cases (curves with bevel, extrude, offset, caps, bevel factors, profiles, twist, radius, 2D fill; NURBS and paths; Edit Mode operators and transforms on selections; text layout settings, text boxes, formats and editing; text on a curve and the Curve modifier) and writes the splines and the evaluated mesh. `tests/curves-wasm.test.js` replays each case through the module and compares splines and meshes exactly (positions within 1e-4).
