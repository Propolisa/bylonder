# Track To (`TRACK_TO`)

Rank 10: 4 uses, in two demo files (chocolate_donut 3, cloth_tear 1: objects, typically cameras and lights,
`TRACK_NEGATIVE_Z` with `UP_Y`). Manual: https://docs.blender.org/manual/en/latest/animation/constraints/tracking/track_to.html

Fixtures: `track_to.fixtures.json` (33 cases, `gen/track_to.py`: objects and bones, every track and up pair, Target
Z, influence, a camera with non-uniform scale, two cases with the up axis parallel to the track direction). All
match to 3e-6 (`tools/check_track_to.py`).

## Settings

| Property | Default | Values |
|---|---|---|
| `target`, `subtarget`, `head_tail`, `use_bbone_shape` | | foundations |
| `track_axis` | `TRACK_NEGATIVE_Z` | six signed axes |
| `up_axis` | `UP_Y` | `UP_X`, `UP_Y`, `UP_Z` |
| `use_target_z` | false | |
| `owner_space`, `target_space`, `influence` | `WORLD`, `WORLD`, 1.0 | |

Invalid when the track and up axes are the same letter: the constraint does nothing (manual).

## Math (owner space)

1. `v = normalize(T.t - O.t)`, negated for a negative track axis. Target at the owner's origin: no change.
2. Up reference `w`: `(0, 0, 1)`, or with `use_target_z` the target's normalized Z column.
3. `u = normalize(w - v (v . w))`. If `w` is parallel to `v`, use `(0, 1, 0)` projected the same way instead (seen
   in both parallel probes).
4. The track axis column is `v`, the up axis column is `u`, the remaining column is the cross product that makes a
   right-handed frame (`X = Y x Z`, `Y = Z x X`, `Z = X x Y`).
5. Columns scaled by the owner's column lengths; translation unchanged.

Then convert back from owner space and blend by influence (foundations).

## Edge cases

- The owner's previous rotation does not matter; only its translation and scale are kept.
- Near the parallel case the roll flips quickly, as the manual warns.
