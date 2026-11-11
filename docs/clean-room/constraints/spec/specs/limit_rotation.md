# Limit Rotation (`LIMIT_ROTATION`)

Rank 8: 15 uses (skeleton_arm_xray 9: bones in `LOCAL`, new behaviour; Rigify 6: bones in `LOCAL`, legacy
behaviour). Manual: https://docs.blender.org/manual/en/latest/animation/constraints/transform/limit_rotation.html

Fixtures: `limit_rotation.fixtures.json` (50 cases, `gen/limit_rotation.py`: objects with Euler modes, bones in
`LOCAL`, `WORLD`, `POSE`, both behaviours, influence, the manual's 340 degree example, a sheared owner without
limits). All match to 3e-6 (`tools/check_limit_rotation.py`).

## Settings

| Property | Default | Values |
|---|---|---|
| `use_limit_x`, `use_limit_y`, `use_limit_z` | false | |
| `min_x`, `max_x`, `min_y`, `max_y`, `min_z`, `max_z` | 0 | radians |
| `euler_order` | `AUTO` | as Copy Rotation; `AUTO` is the owner's Euler mode, else `XYZ` |
| `use_legacy_behavior` | false | |
| `use_transform_limit` | false | editing aid (limits the transform tool); no effect on evaluation |
| `owner_space`, `influence` | `WORLD`, 1.0 | no target |

## Math (owner space)

1. `F = fix_shear(O3)` (foundations): shear is removed even with no limit enabled (`no_limits_sheared`).
2. `s0` = column lengths of `F`, `R0` = `F` with normalized columns, `e` = Euler of `R0` in the order, the solution
   with the smaller sum of absolute angles (Copy Rotation's extraction).
3. For each enabled axis, with `lo = min`, `hi = max`:
   - new behaviour: move `e[i]` by whole turns into `[mid - pi, mid + pi]`, `mid = (lo + hi) / 2`. Inside
     `[lo, hi]` it stays. Outside, it goes to the boundary that is closer around the circle: compare
     `(lo - e) mod 2 pi` with `(e - hi) mod 2 pi`.
   - legacy behaviour: `e[i] = clamp(e[i], lo, hi)` on the extracted angle, without wrapping.
4. Result `euler(e) @ diag(s0)`, translation unchanged.

Then convert back from owner space and blend by influence (foundations).

## Edge cases

- The manual's example: X limited to 0..90 degrees, owner at 340 degrees, gives 0 (`manual_340`).
- Bones affected by IK: the manual says the constraint does not work for them (IK runs after it); use the bone's IK
  limits.
