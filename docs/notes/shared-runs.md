# Shared runs

Several runs of one package (each a `BlendScene` on its own Babylon `Scene`) on one `Engine` share what never changes,
and each keeps what it writes. Hop 5 of `docs/data-flow.md` (From .blend to the game views). Read from Babylon 8.32.0's
source.

## Who owns what in Babylon

| Resource | Owner | Held by | Freed by |
| --- | --- | --- | --- |
| `DataBuffer` (GL buffer) | Engine | `Buffer`, or a geometry's index buffer; `references` counts holders | `engine._releaseBuffer` at 0 |
| `Buffer` | its `VertexBuffer` when made from data; else whoever made it | `VertexBuffer`s (`_ownsBuffer` false when given a `Buffer`) | `Buffer.dispose` |
| `VertexBuffer` | its `Geometry` | the geometry | `Geometry.dispose`, or being replaced by `setVerticesData` |
| Index buffer | its `Geometry` | the geometry | `Geometry.dispose`, `setIndices` |
| `Geometry` | Scene (`scene.geometries`) | its meshes | the last mesh's dispose; a geometry no mesh uses outlives `scene.dispose` |
| `InternalTexture` | Engine (`getLoadedTexturesCache()`) | each `Texture` of the same URL and sampling; `_references` | the last `Texture.dispose` |
| `Texture`, `RawTexture` | Scene | materials | `scene.dispose` |
| `Effect` | Engine (`_compiledEffects`, by shaders and defines) | materials, sub-meshes; `_refCount` | the last `Effect.dispose` |
| `Material`, `UniformBuffer` | Scene | meshes | `scene.dispose` |
| Bone matrix texture, morph target texture | their `Skeleton`, `MorphTargetManager` (Scene) | the owner | its dispose |
| Instance and thin-instance buffers | their `Mesh` | the mesh | mesh dispose |

Babylon already shares, per engine, compiled effects (a second run compiles no shader) and textures loaded by URL.

## The seam

`runtime/shared-resources.js`, with one call site in each hub:

- `sharedPackage` (scene.js `readData`): scene.bin's arrays and the parsed IR, read once per package version on the
  page, held by a `WeakRef` while a run uses them. The IR is frozen; each run gets its own table of the arrays.
- `sharedIR` (`BlendScene` constructor): `readIR`'s validated IR, once per version, frozen. A run gets a view with its
  own clock, entities and order; a patch copies the one IR table it changes (`BlendScene.patch`).
- `sharedGeometry` (`sceneTables`): each vertex stream a non-updatable `Buffer` per engine, keyed by its array's
  content name, wrapped in each run's own `VertexBuffer` (Babylon's public constructor, which does not own it), counted
  by geometries and let go of on dispose. Unused streams are kept up to 64 MB for a run loaded again or a patch undone,
  and forgotten when the context is restored. A released buffer throws with its name if drawn.
- `sharedStatus(scene)`: one line per run, "149 shared streams, 36 own live, 0 poisoned, 0 failed".

No private field is read or written and Babylon is not patched. Index buffers stay a geometry's own:
`Geometry.setIndexBuffer` empties the CPU indices that picking and sub-mesh bounds read.

## Updates

A shared buffer is never updated: an edit makes arrays of new names, a patch makes geometries that take them, and the
old ones are let go of once no run uses them. What a run deforms (Snow: 36 position and normal streams) it replaces on
its own geometry with an updatable buffer and updates in place. Bone matrices, morph weights, instance matrices,
particles and uniform buffers are made per scene by Babylon. A failure while sharing lets go of what was taken and
asks for the run to be loaded again (`reload`), never a run half shared.

## Measured

Snow (Character Controller demo), two runs on one engine in headless Chromium on SwiftShader:

| | Run 1 | Run 2 |
| --- | --- | --- |
| GPU buffers made, bytes uploaded | 317, 18.0 MB | 126, 9.7 MB |
| Textures made | 64 | 34 |
| JS heap (after GC) | +382 MB | +290 MB (+349 MB with no package sharing) |

Edits, exported alone (`exportChanged`) and applied as patches to each run: on Rigged Character the export takes
0.8 to 1.3 s and each run applies in 2 to 10 ms; on Snow the export takes about 300 s, as long as a whole export, and
each run applies a move in 250 ms (1.2 s to the frame, as shaders recompile), a material value in 50 ms and new mesh
data in 190 ms. The export dominates; the shared runtime applies as fast as the unshared one.

Run A walking 20 frames leaves run B's bones and every shared byte (read back from the GPU) unchanged; disposing A
leaves B drawing. Of run 2's heap, the native rig's state is the largest part (`native-rig.js` 84 MB,
`native-solve.js` 14 MB), built per run from shared arrays.

## Risks, and what is not shared

- `getVerticesData` returns the shared array unless asked for a copy; code writing into it in place (Babylon's
  `Mesh.updateMeshPositions`) changes the CPU copy every run reads, though not the GPU buffer. Typed arrays cannot be
  frozen; live data goes through a copy, as the runtime's code does.
- After a context loss Babylon rebuilds a shared buffer once per geometry using it, leaving the earlier rebuilds to
  the garbage collector.
- Not shared, and not shareable through Babylon's API: index buffers, morph target textures, thin-instance matrices,
  data textures (`RawTexture`), materials. Textures by URL are freed at their last reference, so loading again with no
  run left uploads images again.
