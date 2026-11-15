# Character deform: open items

What the native-deform track left open: two decisions and a prototype. Snow (`character-controller.blend`, Blender
Studio, CC BY 4.0) is the measured case throughout; keep it out of normal tests.

## Viewport or render stack for character exports

An export evaluates a character as Blender renders it (`render-evaluation.js evaluateForRender`): modifiers Disable in
Viewports leaves off, as Snow's face lattices, are shown while the export reads them. The owner decides which stack
packages ship. The facts for that decision:

- On Snow's viewport stack, the head and trousers are exact with GPU skinning plus the mesh's own shape keys as morph
  targets: their Corrective Smooth is off in both stacks and the face lattices are render only. The residual against
  Blender was 0.00 mm over 258 train, 155 clip and 40 effect poses (prototype below).
- That zero is with Preserve Volume as the file sets it (the trousers, body, shirt, shoes and hair skin with dual
  quaternions). Babylon runs them on the GPU (`runtime/dual-quaternion-skinning.js`, per armature setting
  `use_dual_quaternions`, on by default). Linear skinning was not measured.
- Real residuals on the viewport stack: the shirt (Corrective Smooth on whenever the rig's `Quality` property is above
  0; a Mask cuts 1839 to 1679 vertices) and the tongue (Corrective Smooth always on).
- Not measured: which meshes the judged skin check puts on GPU skinning with the viewport stack, and the page's
  milliseconds per frame. `VIEWPORT_STACK` in `render-evaluation.js` (branch `psd-prototype` only) exports with
  render-only modifiers off; `tools/psd-prototype/run.sh` there exports Snow that way and times the runtime
  (`cpu-ms.mjs`). It needs about 12 GB; it was never run, for memory.

## Corrective shapes prototype

Branch `psd-prototype` (WIP, not for main), `tools/psd-prototype/`, with `STATUS.txt` and the run logs. `psd.py` runs
in the reference Blender with numpy: it fits pose-driven corrective shapes (PCA, per-region RBF) to the difference
between a GPU skin and Blender's evaluated mesh, inverting the skin per vertex by its Jacobian.

- Base it on the GPU skin plus the shape keys at their driven values (`KEYED_BASE`): the earlier large residuals were
  the shape keys themselves, which the runtime already runs as morph targets.
- Next: fit the shirt and the tongue (Corrective Smooth) with `LINEAR_SKIN` and without, at the viewport subdivision
  level (Simplify off). `psd.py` applies the viewport Masks so the shirt's vertices match.
- Mixed poses blend custom properties with the same factor as the bones (`Quality` drives the shirt's smoothing).

## Landed on the way

- The rig's description references each mesh's data by its Mesh (`ir.meshes`, `ME:<name>`), so a mesh edit patches
  that entry alone; the page puts it into the rig it runs (`native-solve.js remesh`).
- `rigMemo` (`rig-description.js`) keeps what a rig's descriptions read, and each mesh's runtime judgement, from export
  to export; a full export reads everything again.
- A mesh the native runtime deforms draws with its deform alone (no morph targets, no skeleton): one writer per
  vertex position.
- Objects parented to a bone follow the rig skeleton (`skin-skeleton.js hangFromBone`).
