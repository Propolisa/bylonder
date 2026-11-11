# Child Of (`CHILD_OF`)

Rank 12: 3 uses, in pizza_delivery (bones, owner `POSE`, target `WORLD`). Manual:
https://docs.blender.org/manual/en/latest/animation/constraints/relationship/child_of.html

Fixtures: `child_of.fixtures.json` (24 cases, `gen/child_of.py`: objects and bones, inverse identity or pending,
per-axis flags, influence). Objects: all exact. Bones: exact without flags; two flag cases open.
Check: `tools/check_child_of.py`.

## Settings

| Property | Default | Notes |
|---|---|---|
| `target`, `subtarget`, `head_tail`, `use_bbone_shape` | | foundations |
| `use_location_x/y/z`, `use_rotation_x/y/z`, `use_scale_x/y/z` | true | |
| `inverse_matrix` | stored 4x4 | the Set Inverse result; files carry it |
| `set_inverse_pending` | true on a new constraint | the next evaluation computes and stores the inverse |
| `owner_space`, `target_space`, `influence` | `WORLD`, `WORLD`, 1.0 | |

## Math

1. `O` = owner in owner space. `T` = target matrix. For an object owner, `T` is the target's world matrix. For a bone
   owner, `T` is the target converted into the owner space (the `target_space` setting was not followed: with owner
   `POSE` and target `WORLD`, the target entered in armature space, case `bone_identity_all_7`).
2. Parent matrix `P`: split `T` into translation, rotation (normalized columns) and column lengths (Copy Transforms'
   split); take the rotation's `XYZ` Euler (smaller-sum solution); set disabled rotation axes to 0 and disabled
   scale axes to 1; rebuild.
3. Result `P @ inverse_matrix @ O`.
4. Disabled location axes keep the owner's own value: `result.t[i] = O.t[i]` (not a zeroed parent translation).
5. Convert back from owner space; influence blend (foundations).

Set inverse (`set_inverse_pending`): Blender stores a matrix so that the result equals the owner's matrix at that
moment, then clears the flag. Observed values: objects `inverse(P)` (world); bones with owner `WORLD`:
`inverse(ArmatureWorld^-1 @ P)`, the target relative to the owner's armature. After the first evaluation the stored
matrix is used as in step 3. Exports should carry the stored `inverse_matrix` and the pending flag as saved.

## Open

- Bone owners with per-axis flags in `LOCAL` or `POSE` space (`bone_identity_flags_11`, `bone_identity_flags_23`):
  where the flags apply is not found. No counted file uses flags.
