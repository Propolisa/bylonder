# Babylon × Blender: how the project balances them

Snapshot of current state, 2026-10-25. Describes what is, not what must be.

## Principle
Babylon owns runtime, data and evaluation. Blender owns UX: names, layout, icons, shortcuts, interaction. Where they conflict, Babylon's model wins and the Blender UX is mapped onto it.

## Decisions in place
| Area | Babylon side | Blender side | Current choice |
|---|---|---|---|
| Source of truth | Scene built by user code | .blend file | Code. Interactive edits are a diff over code ("Remember scene edits"), similar to Blender library overrides |
| Identity | Object names | Datablock names / pointers | `metadata.wbId`, falling back to name; `workbench.editable(node, {id})` for explicit ids. Renaming in code drops saved edits |
| Axes | Y-up, left-handed | Z-up | Babylon axes everywhere (gizmo, grid, views); Blender colours |
| Viewport shading | Scene `clearColor` | Theme background in Solid | Solid/Wireframe use the theme background; Rendered shows the scene as authored |
| Editable values | Object properties | RNA paths | Channel registry: `[id, path]` with `get`/`set`, components in the path (`position.x`); re-registering replaces the binding |
| Animation | `Animation` evaluates curves | Actions, slots, F-Curves, NLA, drivers | One action per project; tracks keyed by `[id, path]`; Bézier/Linear/Constant; evaluation writes live objects (no evaluated copy) |
| Document / undo | None | ID database, memfile undo | Named document slices (`capture`/`apply`) plus object snapshots; undo stores whole-state snapshots, 100 steps |
| Materials | Standard, PBR, Node materials | Material datablocks, slots | Blender datablock UX over Babylon types; slots via `MultiMaterial`; Principled = `PBRMaterial`; Surface type converts in place |
| Users / orphans | None | User count, fake user, orphans dropped on save | Counted from slots on demand; saved edits drop zero-user created materials unless fake user; undo keeps them |
| Node editors | NME, NGE, NRGE, NPE (React) | One Node Editor with tree types | Babylon editors embedded unchanged, Blender skin via generated CSS-module map; context follows Blender (active material, modifier, scene, emitter) |
| Compositor | Frame graph (alpha) | Compositor, viewport compositor | `NodeRenderGraph` behind Use Nodes; applied only in Rendered shading and camera view |
| Geometry nodes | `NodeGeometry` | Geometry Nodes modifier | Modifier type in our stack; group stored as JSON on the modifier |
| Particles | Node particle sets | Particle systems on objects | Stored on objects; Properties > Particles |
| Logic | FlowGraph, no editor package | (none current) | Own minimal editor; isolated in `src/graphs/logic*.js` |
| Scene settings | `Scene` properties (`gravity`, `activeCamera`) | Scene datablock: camera, unit_settings, gravity | Document slice `scene`, shaped like Blender's Scene; Babylon writes isolated in `src/scene/scene-babylon.js`; saved as a diff from code |
| Units | Unitless | Scene > Units, display only | 1 Babylon unit = 1 m before Unit Scale; one shared `unitSettings` read by every property row; unitless input uses the displayed unit |
| World | No World object: `clearColor`, `environmentTexture`, skybox, fog | World datablock linked to the scene; Background and Volume shaders | Document slice `worlds`, shaped like Blender's World (`background`, `volume`, `visibility`); `src/scene/world-babylon.js` is the only code that maps it onto the scene. Code-built scene becomes "World", saved as a diff. Colors stored in Babylon's space (no linear conversion). Volume Scatter = exponential fog; extra Babylon fog modes listed as such |
| World in viewport | Always rendered | Solid shows theme background, no world volume | Background, skybox and fog only in Rendered shading and camera view; environment lighting stays on in all modes |
| Properties tabs | (none) | Scene, World, Object, Modifiers, Particles, Material | Blender order; header shows the Blender breadcrumb (Scene > World) |
| Graph inputs | Input blocks, `editableInPropertyPage` | Exposed group inputs | Reflected into channels by block name; Node Material: uniform inputs only (avoids shader rebuilds) |

## Deferred / open
- Scene: Keying Sets, Audio, Rigid Body World, Simulation range, Background Scene; frame rate and range still live on the action, not the scene.
- World: Mist Pass, Light Probe and Sun settings, Viewport Display color, world node trees.
- Action slots, NLA, layers, drivers as data, F-Curve modifiers, editable handles.
- Object data (transforms, modifiers, particles) as a document slice instead of `storage.js` snapshots.
- Undo storing diffs instead of all channel values.
- Config UI for FlowGraph blocks that need one; pointer-event blocks absent in Babylon 8.32.
- Replace the Logic editor if Babylon ships one.
- Babylon editors are singletons; their internal undo is separate from ours.
