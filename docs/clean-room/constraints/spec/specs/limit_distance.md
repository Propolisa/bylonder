# Limit Distance (`LIMIT_DISTANCE`)

Rank 11: 4 uses, all in the Rigify rig (bones, `CUSTOM` space, Inside). Manual:
https://docs.blender.org/manual/en/latest/animation/constraints/transform/limit_distance.html

Fixtures: `limit_distance.fixtures.json` (28 cases, `gen/limit_distance.py`: three modes, distance 0 and set,
`CUSTOM` space for objects and bones, influence). All match to 3e-6 (`tools/check_limit_distance.py`).

## Settings

| Property | Default | Values |
|---|---|---|
| `target`, `subtarget`, `head_tail`, `use_bbone_shape` | | foundations |
| `distance` | 0.0 | 0 means "not set yet" |
| `limit_mode` | `LIMITDIST_INSIDE` | `LIMITDIST_INSIDE`, `LIMITDIST_OUTSIDE`, `LIMITDIST_ONSURFACE` |
| `use_transform_limit` | false | editing aid; no effect on evaluation |
| `owner_space`, `target_space`, `influence` | `WORLD`, `WORLD`, 1.0 | |

## Math (owner space)

1. `v = O.t - T.t`, `L = |v|`.
2. If `distance` is 0, set it to `L` and store it on the constraint (`constraints_after` shows the stored value);
   that evaluation changes nothing.
3. Inside: if `L > distance`, move the owner to `T.t + v / L * distance`. Outside: the same when `L < distance`.
   On Surface: always.
4. Only the translation changes.

Then convert back from owner space and blend by influence (foundations).

## Edge cases

- In `CUSTOM` space the distance is measured in the custom object's units, so it scales with that object (manual
  tip; the Rigify uses).
- Owner exactly at the target (`L = 0`): no change (assumed; not probed).
- Connected bones: no visible effect (foundations).
