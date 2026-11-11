# Damped Track (`DAMPED_TRACK`)

Rank 6: 34 uses, all in the Rigify rig (bones, `WORLD` space, `TRACK_Y`).
Manual: https://docs.blender.org/manual/en/latest/animation/constraints/tracking/damped_track.html

Turns the owner by the shortest rotation that points one of its axes at the target. Fixtures:
`damped_track.fixtures.json` (20 cases, `gen/damped_track.py`: objects, sheared owners, bones in `WORLD`, `POSE`,
`LOCAL`, all six axes, influence). All match to 3e-6 (`tools/check_damped_track.py`) except the exactly-opposite
case noted below.

## Settings

| Property | Default | Values |
|---|---|---|
| `target`, `subtarget`, `head_tail`, `use_bbone_shape` | | foundations |
| `track_axis` | `TRACK_Y` | `TRACK_X`, `TRACK_Y`, `TRACK_Z`, `TRACK_NEGATIVE_X`, `TRACK_NEGATIVE_Y`, `TRACK_NEGATIVE_Z` |
| `owner_space`, `target_space`, `influence` | `WORLD`, `WORLD`, 1.0 | |

## Math (owner space)

1. `a` = the owner's column for the track axis, normalized, negated for a negative axis.
2. `b` = `normalize(T.t - O.t)`.
3. `S` = the shortest rotation taking `a` to `b`: axis `cross(a, b)`, angle `acos(a . b)`. In matrix form,
   `S = I + K + K^2 / (1 + a . b)` with `K` the cross-product matrix of `cross(a, b)`.
4. Result 3x3 `S @ O3` (the whole owner matrix is rotated, so a sheared owner stays sheared and its scale is kept);
   translation unchanged.

Then convert back from owner space and blend by influence (foundations).

## Edge cases

- Target at the owner's origin: no change (`coincident`).
- Target exactly opposite the axis: Blender turns 180 degrees. In the one probe (identity owner, `TRACK_Y`, target
  on -Y) it turned about the X axis, giving `diag(1, -1, -1)` (`opposite`). Other axes are not probed.
