# Copy Rotation (`COPY_ROTATION`)

Rank 4: 48 uses (Rigify 33: `REPLACE` in `LOCAL`, `WORLD` and `POSE`, 4 `ADD` with order `YXZ` copying X only and
inverted, 4 legacy `OFFSET` with all axes; skeleton_arm_xray 11 `REPLACE` in `LOCAL`; pizza_delivery 4 including
`AFTER` from `LOCAL_WITH_PARENT` to `POSE`).
Manual: https://docs.blender.org/manual/en/latest/animation/constraints/transform/copy_rotation.html

Fixtures:

- `copy_rotation.fixtures.json`: 40 random cases (`gen/copy_lrs.py`), all mix modes, Euler orders, flags, sheared
  targets and owners, influence.
- `copy_rotation_branches.fixtures.json`: 240 cases choosing between the two Euler solutions (`gen/rot_branch.py`).
- `copy_rotation_offset.fixtures.json`: 100 cases of the legacy `OFFSET` mode (`gen/rot_offset.py`).

All match to 3e-6 (`tools/check_copy_rotation.py`) except legacy `OFFSET` combined with an inverted axis (see Open).

## Settings

| Property | Default | Values |
|---|---|---|
| `target`, `subtarget`, `head_tail`, `use_bbone_shape` | | foundations |
| `use_x`, `use_y`, `use_z` | true | |
| `invert_x`, `invert_y`, `invert_z` | false | |
| `euler_order` | `AUTO` | `AUTO`, `XYZ`, `XZY`, `YXZ`, `YZX`, `ZXY`, `ZYX` |
| `mix_mode` | `REPLACE` | `REPLACE`, `ADD`, `BEFORE`, `AFTER`, `OFFSET` (legacy) |
| `use_offset` | false | deprecated; read true with `ADD`, `AFTER` and `OFFSET` in the counted files |
| `owner_space`, `target_space`, `influence` | `WORLD`, `WORLD`, 1.0 | |

`AUTO` uses the owner's rotation mode when it is an Euler order (object `rotation_mode`, pose bone
`rotation_mode`), else `XYZ`.

## Euler conventions

Order `ABC` means `R = R_C @ R_B @ R_A` (A applied first). Angles are kept per axis (`e.x`, `e.y`, `e.z`) whatever
the order.

Extraction for an even order (`XYZ`, `YZX`, `ZXY`): permute axes so the order reads `XYZ` (`N = P M P^T`), then
`x = atan2(N21, N22)`, `y = atan2(-N20, hypot(N00, N10))`, `z = atan2(N10, N00)`; the second solution is
`atan2(-N21, -N22)`, `atan2(-N20, -hypot(N00, N10))`, `atan2(-N10, -N00)`. For an odd order, extract the reversed
order from `M^T` and negate all angles. These formulas also run on non-orthogonal input (see below), so use exactly
these entries.

- The owner's Euler: the solution with the smaller sum of absolute angles.
- The target's Euler is made compatible with the owner's: each angle of each solution is moved by whole turns to lie
  within pi of the owner's angle, then the solution with the smaller sum of absolute differences wins.

## Math (owner space)

1. Owner: `s0` = column lengths, `R0` = columns divided by their lengths (not orthogonalized), `eo` = Euler of `R0`.
2. Target: `Rt` = `fix_shear(T3)` (foundations) with its columns normalized; `et` = Euler of `Rt`, compatible with
   `eo`.
3. `p[i] = et[i]` for used axes, negated if inverted; 0 for unused axes.
4. Rotation by mix mode:
   - `REPLACE`: `R = euler(e)` with `e[i] = p[i]` on used axes and `eo[i]` on the others.
   - `ADD`: `R = euler(eo + p)`.
   - `BEFORE`: `R = euler(p) @ R0`.
   - `AFTER`: `R = R0 @ euler(p)`.
   - `OFFSET` (legacy): `R = euler(e) @ Rx(o.x) @ Ry(o.y) @ Rz(o.z)`, `e` as in `REPLACE`, `o[i] = eo[i]` on used
     axes and 0 on the others. The second factor is always composed X, Y, Z from the left, whatever the order.
5. Result `R @ diag(s0)` with the owner's translation.

Then convert back from owner space and blend by influence (foundations).

## Edge cases

- `REPLACE`, `ADD` and `OFFSET` rebuild the rotation from Euler angles, so a sheared owner loses its shear (the
  manual's "removes shearing"); `BEFORE` and `AFTER` multiply `R0`, so its shear stays.
- Near gimbal lock (`hypot(N00, N10)` close to 0) the solution is not verified against the oracle.

## Open

- Legacy `OFFSET` with an inverted axis does not follow the formula above (10 of 100 probe cases, all with
  `invert_y`). No counted file inverts an axis in `OFFSET` mode.
