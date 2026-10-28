# Node editors

How the Shader Editor and the Compositor work: one Babylon graph per tree, holding Babylon's blocks and Blender's nodes, edited in a node editor that behaves as Blender's. Decided 2026-10-28.

## Decisions

1. **The graph is Babylon's.** A material's tree is its `NodeMaterial`, the compositor's its `NodeRenderGraph`. Babylon builds, renders, serializes and undoes them as before, and its own editors still open them (the header's Babylon Editor toggle). Layout lives in the graph's `editorData` in Babylon's format (locations, `isCollapsed`, frames), so both editors show the same layout.
2. **A Blender node is a Babylon block.** Each Blender node type Bylonder runs is a block class named by its idname (`ShaderNodeMath`, `CompositorNodeColorBalance`), registered with `RegisterClass`, so Babylon creates it when it loads a graph. Its sockets are Blender's declaration (`src/nodes/blender/node-types.json`, dumped from Blender 5.2.3 by `tools/blender-reference/nodes.py`, with which sockets each enum value or menu item shows). It saves its properties, socket values and mute under `blender` in Babylon's block JSON.
3. **Its code is Blender's.** `tools/blender-nodes/gpu.py` fetches the GLSL libraries Blender's GPU node code links, with what they include, and the tables the node's C++ picks a function from (`get_float_math_operation_info`, the Mix node's `gpu_shader_get_name`) into `gpu-library.js`, with what the node's C++ declaration states that Python does not show (menu socket items, outputs drawn on an input's row). `glsl.js` turns Blender's C++-style GLSL into WebGL 2 GLSL ES as Blender's own preprocessor and `gpu_shader_compat_glsl.glsl` do (macros, references as `inout`, swizzle calls, `f` suffixes), plus a short list of fixes where desktop GLSL allows what GLSL ES does not. A node's steps (`SHADER_NODES`, `COMPOSITOR_NODES`) are a port of its `gpu_shader`/`node_gpu_material` function: which GLSL function, which sockets in which order, with the extra constants and the clamps it links.
4. **Shader nodes.** A Blender shader block emits its functions with `_emitFunction` and calls them in the material's code; an unlinked input is a uniform set each frame from the node's value, as Blender's `GPU_uniform`, so values change without a rebuild while properties (Math's operation) rebuild, as Blender recompiles.
5. **Compositor nodes.** Blender runs pixel nodes as a fragment shader over the image (its pixel operations). A Blender compositor block is a Babylon post process: its fragment shader calls the node's function on the texel of its image input, with the other inputs as uniforms. Muted, it is a disabled frame graph task, which copies its source through.
6. **Sockets.** Blender's socket types are Babylon's connection point types: Float, Int, Boolean and Menu as `Float`, Vector as `Vector3`, Color as `Color4`, the compositor's images as textures. A Blender input takes any value, vector or color, converted as Blender's code generation converts (`float_from_float4` and kin: luminance for a color read as a value, the average for a vector). A Blender output takes the type of the Babylon input it is linked to when Blender converts to it, so a Mix Color output feeds a Color3 albedo. Matrices, shader closures and Babylon's object types do not link to Blender sockets.
7. **The editor is Bylonder's, on Blender's terms.** Babylon's editors are React bundles whose canvas, links and frames would all change to behave as Blender's, and new UI here is Vue. So the editor is Bylonder's own (`src/editors/space_node`): it draws nodes as `node_draw.cc` does in Blender 5.2's theme, runs Blender's Node Editor keymap, and takes from Babylon's editors what makes a block: their block catalogs and `BlockTools` (forked from their sources by `tools/babylon-editor/vendor.mjs`) and the block properties they edit (`@editableInPropertyPage`).
8. **The Add menu is Blender's.** Shift A opens `NODE_MT_add` and the `node_add_menu_*.py` menus, compiled by the transpiler, and typing searches them with the extra entries Blender's menus add for search (Math > Multiply). Entries add the Blender nodes Bylonder runs; the others are greyed out. Babylon's blocks are in a Babylon sub-menu at the end of the matching Blender categories, as an add-on extends Blender's menus.

9. **Shader nodes reach the scene's geometry through helpers.** What Blender's GPU code reads of the shaded point (position, normal, texture space, UVs) comes from Babylon blocks Bylonder links to hidden inputs, named `blender:` (or the attribute's name). The editor draws neither them nor their links. Principled BSDF is Babylon's PBR block and Material Output Babylon's fragment output, with the vertex output a material needs added when one is placed. Main's node tree of the material (the scene sync) has the Blender nodes, their input values and links.

## What a Blender user finds

| Blender | Here |
|---|---|
| Shift A Add menu, typing searches | Blender's own menus and search; Babylon's blocks under Babylon in each category |
| Node look: class colored headers, socket colors and shapes, values on unlinked inputs, buttons | Drawn from Blender's theme and the node's declaration |
| Click, Shift click, box drag on empty space, A, Alt A, Ctrl I | Same |
| G or drag to move, click or Enter confirms, Esc or right click cancels | Same |
| Drag from a socket to link, from a linked input to pick the link up, drop on a node for its best socket | Same |
| Ctrl right drag cuts links, Shift right drag adds reroutes | Same; reroutes are Babylon's Elbow blocks |
| M mute, H collapse, Ctrl H hide unused sockets, X and Ctrl X delete, Ctrl J frame, J link, Shift D duplicate, Home view all | Same, by Blender's keymap |
| Frames shrink to their nodes | Same; frames are Babylon's editor frames |
| Muting a node passes its input through, drawn red | Blender nodes and compositor blocks; Babylon's material blocks cannot mute |
| Node groups, Tab | Not yet: Babylon graphs have no groups |

## Files

- `src/nodes/blender/`: the node types (`node-types.json`), Blender's GLSL (`gpu-library.js`, `glsl.js`), sockets, the code steps (`node-code.js`) and the block classes (`shader-nodes.js`, `compositor-nodes.js`).
- `src/editors/space_node/`: the editor: `node-tree.js` (a Babylon graph as a node tree), `node-layout.js` (where node parts go), `node-editor-controller.js` (Blender's operators and modal handlers), `NodeEditor.vue`, `NodeView.vue`, `NodeValue.vue`, `NodeColorRamp.vue` (a Color Ramp's ramp, as `uiTemplateColorRamp`), `node-add-menu.js`, `blender-node-editor.js` (mounting and keys), `babylon/` (forked catalogs).
- Tests: `tests/nodes.test.js` (graphs with both kinds of nodes build, save and load), `tests/nodes-gpu.test.js` (192 cases of Math, Mix, Noise Texture and Color Ramp run in WebGL 2 match Blender's GPU compositor output, `tests/fixtures/blender-nodes.json` from `tools/blender-reference/node-fixtures.py`), `tests/node-editor.test.js` (menus, linking, cutting, keymap, the lava material of `docs/lava-material.md` built from the Add menu), `tests/e2e/smoke.mjs` (the same in the app, shown in Material Preview).

## Next

1. More nodes by porting their steps: Clamp, Map Range, Vector Math, Invert, Combine and Separate XYZ, Voronoi Texture.
2. Principled BSDF's socket panels (Subsurface, Specular, Emission, ...), collapsed as Blender draws them.
3. Compositor: other inputs linked from images (more textures per pass), multi-pass nodes (Glare, Blur) as chains of tasks, and Blender's pixel operation fusion (several pixel nodes in one pass).
4. Link drag search (dropping a link on empty space), node insertion on links with auto-offset, Shift S swap menu from Blender's swap menus.
5. Node groups and Tab, as Babylon custom blocks over a subgraph.
6. The sidebar (N): Node and Properties panels from Blender's `space_node.py` panels.
