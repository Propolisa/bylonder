# Blender interface alignment

Reference: https://docs.blender.org/manual/en/latest/interface/index.html

The linked latest manual is currently indexed as Blender 5.2 LTS. Direct retrieval returned HTTP 402 in the documentation reader and HTTP 403 from the execution environment. The indexed official text was used for Areas, Regions, Tabs & Panels, Buttons, Input Fields, Menus, Eyedropper, Decorators, Data-Block Menu, and modifier behavior. Index coverage included workspaces/topbar/status, keymaps, list/tree views, colors/curves, tools/operators, undo and selection. A complete read of every descendant page was not possible; this is not a claim of exhaustive manual review.

## Architecture retained

- Vue 3 and Splitpanes own layout; stable content hosts prevent canvas/Monaco/iframe recreation during resizing.
- Shared property schemas and stable data addresses connect controls, animations, modifier values and serialization.
- Babylon objects remain scene identities. Generated instances are evaluated geometry of one object, not extra Outliner objects.
- Existing history, OPFS versioning and optional scene overrides remain the persistence path.

## Shell vocabulary and primitives

| Blender primitive | Implementation |
| --- | --- |
| Area / Editor Type | Dock leaf with an editor selector, split tree, maximize, join and swap |
| Header | Compact editor controls and Area Options |
| Region | Independent scrollable content; Properties has a context region and main region |
| Properties context tabs | Object, Modifiers, Scene; actual Blender SVG icons |
| Panel / subpanel | Reusable collapsible Vue component with Ctrl-click isolation |
| Property / decorator | Schema field, scalar/component reference, dot/diamond, state colors and context menu |
| Data ID | Stable object reference stored separately from the displayed name |
| Operator | Existing shared command registry and transactional modifier operations |
| Modifier stack | Ordered non-destructive evaluation over original mesh data |

Properties and Timeline support multiple area instances through `dock.setFactory(type, factory)`. Factories return disposable views and own their local UI state; scene state remains shared. Existing viewport, Outliner, Monaco and Files content remain singleton views. Splitting a singleton runtime editor opens a Properties area. Multiple independently navigable viewports and independently instanced Monaco/Outliner editors are not implemented.

Area Options offer vertical/horizontal splits, joining to a sibling and maximizing. Corner gestures split inward, join into another area, or Ctrl-drag to swap. Ctrl-Space maximizes the hovered area. Arbitrary Blender polygonal docking, native windows, aligned-border resize, and every corner-drop permutation are not reproduced. Layouts migrate existing preferences and remain device-wide, project independent.

## Visual changes

The supplied screenshot illustrates panels, not colored panel borders in Blender itself. The yellow/red rectangles are documentation annotations and are intentionally not UI chrome.

Properties now uses neutral gray panels and aligned fields, a vertical context strip, compact headers, object-context pinning, transform locks and per-property animation decorators. Object context uses orange; Modifiers uses blue. Unanimated properties use a dot, animated properties an empty diamond, and keyed properties a filled diamond. Keyed fields are yellow, animated fields green, and modified animated fields orange.

Original Blender icons are included from https://github.com/blender/blender/tree/main/release/datafiles/icons_svg with the upstream license notice and GPL license text in `public/icons/blender`. Font metrics, browser antialiasing and larger touch targets mean this is not pixel-identical rendering.

Number fields support horizontal dragging, Shift precision, Ctrl snapping, keyboard editing, cancellation, arithmetic, units and reset-to-default. Data ID choices preserve IDs during renaming. General eyedropper selection, multi-field drag editing, Python expressions/drivers, every Blender widget, arbitrary panel drag ordering and alternate keymaps remain future work. The reusable row/panel/context primitives provide extension points without changing scene systems.

## Array target and semantics

Target: https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/array.html

This URL now describes the newer Array (Line, Circle, Curve, Transform). The old Fixed Count / Fit Length / caps / Relative + Constant Offset modifier is separately documented as Array (Legacy); it is not the target of this implementation.

Array uses a declarative scalar schema, conditional sections, stable modifier IDs, animatable values, and an ordered stack. Count includes the first copy. Relative line offsets use evaluated local geometry bounds; Endpoint divides the displacement across the copies. Circle supports full/arc arrangements, count/angular distance, axis, radius and tangent alignment. Transform supports input transforms or a referenced object. Curve distributes copies by sampled arc length with per-spline or total count. Randomization is deterministic for a given seed. Realize Instances produces VertexData; Merge requires realization.

Babylon Node Geometry implements realization with an original-geometry block, an instance-transform block, native `InstantiateBlock`, and `GeometryOutputBlock`. Unrealized results use native thin instances. Apply bakes the selected modifier against original data, matching the documented behavior for applying a non-first modifier. Mesh source data and remaining stack stay separate. Geometry generation is capped at 10,000 instances and 1,000,000 realized vertices to keep the browser responsive; exceeded limits are reported.

Compatibility limits: seeded random values are deterministic but not verified bit-for-bit against Blender's generator; exact spline tilt/NURBS/Bezier evaluation requires the caller to supply evaluated samples through `workbench.curve`; welding retains UV/normal seams and does not reproduce Blender's full corner-domain topology model; skinned/morph-target meshes are excluded. Defaults and edge cases were checked against accessible documentation and Babylon headless tests, not against a running Blender installation. Render visibility metadata is reserved for a future export/render path and is not presented as a working render switch.
