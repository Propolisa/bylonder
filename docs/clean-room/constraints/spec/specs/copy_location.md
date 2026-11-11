# Copy Location (`COPY_LOCATION`)

Rank 3: 88 uses (Rigify 82: 48 in `LOCAL` space with Offset, 34 in `WORLD`; pizza_delivery 6).
Manual: https://docs.blender.org/manual/en/latest/animation/constraints/transform/copy_location.html

Fixtures: `copy_location.fixtures.json` (40 cases, `gen/copy_lrs.py`: objects, sheared targets, bones in `LOCAL`,
`POSE`, `WORLD`, `LOCAL_WITH_PARENT`, random axes, inversions, offset and influence). All match to 3e-6
(`tools/check_copy_ls.py`).

## Settings

| Property | Default |
|---|---|
| `target`, `subtarget`, `head_tail`, `use_bbone_shape` | foundations |
| `use_x`, `use_y`, `use_z` | true |
| `invert_x`, `invert_y`, `invert_z` | false |
| `use_offset` | false |
| `owner_space`, `target_space`, `influence` | `WORLD`, `WORLD`, 1.0 |

## Math (owner space)

Only the translation column changes; rotation and scale of the owner stay as they are.

For each axis `i` with `use_i`: `v = T.t[i]`, negated if `invert_i`. New `O.t[i] = v`, or `O.t[i] + v` with
`use_offset`. Axes without `use_i` keep the owner's value.

Then convert back from owner space and blend by influence (foundations).

## Edge cases

- Connected bones: no visible effect (foundations: the head is restored after the stack).
- With a bone target, `head_tail` moves the copied point along the target bone.
- In `LOCAL` space with Offset (the Rigify pattern), the target bone's local translation is added to the owner's
  local translation, so the owner moves along its own rest axes by the amount the target moved along the target's.
