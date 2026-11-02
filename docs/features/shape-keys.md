---
id: shape-keys
title: Shape Keys
summary: Shape a mesh with Blender's shape keys, their values, ranges, vertex groups, relative keys, pinning and locks, edit a key in Edit Mode and key its value, drawn as Blender evaluates them or blended by Babylon's morph targets on the GPU.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/animation/shape_keys/introduction.html
  - https://docs.blender.org/manual/en/5.2/animation/shape_keys/shape_keys_panel.html
  - https://docs.blender.org/manual/en/5.2/animation/shape_keys/workflow.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/vertex/blend_from_shape.html
example: shape-keys
thumbnail: shape-keys/thumbnail.png
media:
  - shape-keys/panel.png
  - shape-keys/value.gif
  - shape-keys/edit.gif
  - shape-keys/play.gif
  - shape-keys/runtime.png
ui:
  - PROPERTIES
  - DATA_PT_shape_keys
  - MESH_MT_shape_key_context_menu
  - MESH_MT_shape_key_tree_context_menu
  - VIEW3D_MT_edit_mesh_vertices
  - VIEW_3D
  - EDIT
  - TIMELINE
operators:
  - object.shape_key_add
  - object.shape_key_remove
  - object.shape_key_move
  - object.shape_key_clear
  - object.shape_key_lock
  - object.shape_key_mirror
  - object.shape_key_transfer
  - object.shape_key_apply_to_basis
  - mesh.blend_from_shape
  - mesh.shape_propagate_to_all
  - anim.keyframe_insert_button
  - object.editmode_toggle
code:
  - src/runtimes/shape-keys.js
  - src/draw/mesh-batch-buffers.js
  - src/editors/interface/block-view.js
  - tools/blender-port/wasm/ui-tree.cc
tests:
  - tests/shape-keys-wasm.test.js
limits:
  - Babylon (mapped) blends each key's own normals linearly; Blender recomputes the normals of the blended positions, so shading differs slightly between keys.
  - Babylon (mapped) blends relative keys only, on a mesh with no modifier shown in the viewport; absolute keys (Relative off) and meshes with modifiers evaluate as Blender.
  - On Babylon (mapped) Blender's animation system still evaluates the keys into the mesh each frame (about 4 ms on 32k vertices), though nothing reads that mesh; the depsgraph has no hook to evaluate it only when read.
---
# Shape Keys

Shape keys store other positions of a mesh's vertices: a Basis and keys relative to it, each blended in by its value.
Everything about them is Blender's code in the module: the Key data-block and its key blocks, Properties > Mesh >
Shape Keys (Blender's tree of keys with each key's value, mute and lock), the operators (add, remove, move, clear,
mirror, apply to basis, Blend from Shape), Edit Mode on a key, the shape pinned to the active key, and keying a value
with I. Blender's depsgraph evaluates the keys into the mesh the 3D Viewport draws.

The keys can also be blended by Babylon (docs/runtimes.md): with Shape Keys' Runtime panel on Babylon (mapped), the
mesh is drawn once and each key becomes a target of a Babylon MorphTargetManager, so a value that changes (played or
dragged) only changes a target's influence and the GPU blends it. The blend is Blender's (Basis plus each unmuted
key's value times its offset from its relative key, scaled by its vertex group), so the positions are the same; only
the normals are blended rather than recomputed.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=shape-keys)

The demo is a jelly blob made in Blender by a script (`shape-keys.py`): Squash and Stretch are keyed to make it
bounce, Bulge swells its top half through the Top vertex group, and Wobble is muted.

## Steps

1. **The keys.** Select Blob and open Properties > Mesh (the Data tab): Shape Keys lists Basis and the keys, each with
   its value, mute checkbox and lock. Below the tree, the active key's range, vertex group and relative key.

   ![Properties > Mesh > Shape Keys](../media/features/shape-keys/panel.png)

2. **A value.** Drag Bulge's value: the blob swells where the Top group's weights are high. The pin beside the tree
   shows the active key alone.

   ![Dragging a key's value](../media/features/shape-keys/value.gif)

3. **Edit a key.** Click Stretch, press Tab and move its vertices; Vertex > Blend from Shape mixes another key into it.
   Back in Object Mode the key keeps its new shape.

   ![Editing a key in Edit Mode](../media/features/shape-keys/edit.gif)

4. **Play it.** Squash and Stretch are keyed (I over a value inserts a key at the current frame). Press Space to play.

   ![The keyed bounce](../media/features/shape-keys/play.gif)

5. **Babylon's morph targets.** In Shape Keys' Runtime panel (with the Bylonder icon) pick Babylon (mapped). The blob
   looks the same; the panel lists the normals as the one approximation, and Edit Mode, a modifier or absolute keys
   fall back to Blender with the reason.

   ![The Runtime panel on Babylon (mapped)](../media/features/shape-keys/runtime.png)

## Project files

- [shape-keys.py](../../examples/shape-keys/shape-keys.py): builds the blob, its vertex group, keys and their keyed
  values, in Blender 5.2.
- [shape-keys.blend](../../examples/shape-keys/shape-keys.blend): the file the script saves.
- [index.js](../../examples/shape-keys/index.js): opens the .blend with Blender's reader.
- [shape-keys.bench.js](../../bench/shape-keys.bench.js): a frame on a 32k-vertex mesh with two animated keys, on
  Blender (about 16 ms of CPU) and on Babylon (mapped) (about 4 ms).
- Recorded by [record-shape-keys.mjs](../../tools/docs/record-shape-keys.mjs).
