# Live edit cost

A live edit on Snow's scene (`character-controller.blend`, 84 objects, a 1494-bone rig) reaches the Package View and
the Game in about 47 s for a widened shirt (it was 145 s). That is a scoped export (`scoped-export.js exportChanged`)
of the 28 objects the edit reaches. What remains, and where to look:

- **serializeScene, about 16 s** (`babylon-export.js`): the Babylon serialization of the 28 reached objects, mostly
  Snow's meshes and skins. Most of it re-serializes data the edit did not change: reuse each object's last entries when
  none of its own keys (OB:, ME:, KE:, MA:) is in `changed`, as the rig's samples do (`armature.js rigSamples`).
- **exportIR, about 18 s** (`ir-export.js exportIR`): the IR walk of the reached objects, RIG-Snow's pose bones above
  all (A1 measured 5 to 7 s for the rig alone). Reuse the last `ids` entries of the IDs not in `changed`, by their keys.
- **exportRuntimes, about 8 s**: the rig's description, now kept per mesh and object (native-deform, `rigMemo`).
- Measure with `node --max-old-space-size=8192 tools/perf/live-edit-cost.mjs <blend> mesh move` (edits: material, move,
  mesh; add timers locally; it needs about 8 GB, so watch memory).
