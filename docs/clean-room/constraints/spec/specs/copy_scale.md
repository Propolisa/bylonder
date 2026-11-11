# Copy Scale (`COPY_SCALE`)

Rank 5: 45 uses, all in the Rigify rig (41 in `WORLD` space, 20 of them with Make Uniform; 4 in `LOCAL` with Offset).
Manual: https://docs.blender.org/manual/en/latest/animation/constraints/transform/copy_scale.html

Fixtures: `copy_scale.fixtures.json` (40 cases, `gen/copy_lrs.py`). All match to 3e-6 (`tools/check_copy_ls.py`).

## Settings

| Property | Default | Values |
|---|---|---|
| `target`, `subtarget`, `head_tail`, `use_bbone_shape` | | foundations |
| `use_x`, `use_y`, `use_z` | true | |
| `power` | 1.0 | any float |
| `use_make_uniform` | false | |
| `use_offset` | false | |
| `use_add` | false | only with `use_offset` |
| `owner_space`, `target_space`, `influence` | `WORLD`, `WORLD`, 1.0 | |

## Math (owner space)

`s0` = column lengths of the owner's 3x3, `st` = column lengths of the target's 3x3 raised to `power` (per axis).

1. Make Uniform: `u = cbrt(product of st[i] over the used axes)` (an unused axis contributes nothing, so the cube
   root is still taken). Then every axis uses `u`, and all three axes count as used if any was.
2. For each used axis: `s[i] = st[i]`; with `use_offset`, `s[i] = s0[i] * st[i]`; with `use_offset` and `use_add`,
   `s[i] = s0[i] + st[i] - 1`. Unused axes keep `s0[i]`.
3. Each owner column is rescaled from length `s0[i]` to `s[i]` (direction, including any shear between columns,
   unchanged). Translation unchanged.

Then convert back from owner space and blend by influence (foundations).

## Edge cases

- The target's scale is its column lengths, so a rotated, sheared target reports the lengths of its skewed axes.
- A negative `power` inverts the copied scale. A zero target scale with a negative power is undefined (not observed).
