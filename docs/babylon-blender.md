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
| Graph inputs | Input blocks, `editableInPropertyPage` | Exposed group inputs | Reflected into channels by block name; Node Material: uniform inputs only (avoids shader rebuilds) |

## Deferred / open
- Action slots, NLA, layers, drivers as data, F-Curve modifiers, editable handles.
- Object data (transforms, modifiers, particles) as a document slice instead of `storage.js` snapshots.
- Undo storing diffs instead of all channel values.
- Config UI for FlowGraph blocks that need one; pointer-event blocks absent in Babylon 8.32.
- Replace the Logic editor if Babylon ships one.
- Babylon editors are singletons; their internal undo is separate from ours.
