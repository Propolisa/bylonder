# Stretch To (`STRETCH_TO`)

Rank 2: 144 uses, all in the Rigify rig (deform and tweak bones stretching to the next bone, bone targets with
`head_tail`). Manual: https://docs.blender.org/manual/en/latest/animation/constraints/tracking/stretch_to.html

Points the owner's Y axis at the target, scales Y to reach it and optionally changes X and Z to keep volume.
Fixtures: `stretch_to.fixtures.json` (56 cases, `gen/stretch_to.py`) and `stretch_smooth.fixtures.json` (200-case
sweep of the soft limits, `gen/stretch_smooth.py`); all match below to 3e-6 (`tools/check_stretch_to.py`).

## Settings

| Property | Default | Values |
|---|---|---|
| `target`, `subtarget`, `head_tail`, `use_bbone_shape` | none, none, 0, false | foundations |
| `rest_length` | 0.0 | 0..1000; 0 means "not set yet" |
| `bulge` (Volume Variation) | 1.0 | 0..100 |
| `use_bulge_min`, `bulge_min` | false, 1.0 | 0..1 |
| `use_bulge_max`, `bulge_max` | false, 1.0 | 1..100 |
| `bulge_smooth` | 0.0 | 0..1 |
| `volume` (Maintain Volume) | `VOLUME_XZX` | `VOLUME_XZX`, `VOLUME_X`, `VOLUME_Z`, `NO_VOLUME` |
| `keep_axis` (Rotation) | `SWING_Y` | `PLANE_X`, `PLANE_Z`, `SWING_Y` |
| `owner_space`, `target_space`, `influence` | `WORLD`, `WORLD`, 1.0 | foundations |

## Math (in owner space)

Inputs: owner matrix `O`, target translation `p`.

1. If `keep_axis` is `SWING_Y`, first replace `O3` by `fix_shear(O3)` (foundations). `PLANE_X` and `PLANE_Z` use `O`
   as it is.
2. `h` = translation of `O`; `s0` = column lengths of `O3`; `R0` = `O3` with columns normalized.
3. `v = p - h`, `d = |v|`.
4. If `rest_length` is 0, set it to `d / s0.y` and store it on the constraint (it stays set; the oracle's
   `constraints_after` shows the stored value). The first evaluation therefore leaves the Y scale unchanged.
5. New Y scale: `sy = d / rest_length` (absolute, not multiplied by `s0.y`). Stretch ratio `q = sy / s0.y`.
6. Thickness factor `f = q ^ (-bulge)`, then limited (below).
7. Scales: `VOLUME_XZX`: `sx = s0.x * sqrt(f)`, `sz = s0.z * sqrt(f)`. `VOLUME_X`: `sx = s0.x * f`, `sz = s0.z`.
   `VOLUME_Z`: `sz = s0.z * f`, `sx = s0.x`. `NO_VOLUME`: both unchanged.
8. Axes, `y = v / d`:
   - `PLANE_X`: `z = normalize(cross(R0.x, y))`, `x = cross(y, z)`.
   - `PLANE_Z`: `x = normalize(cross(y, R0.z))`, `z = cross(x, y)`.
   - `SWING_Y`: rotate `R0` by the shortest rotation that takes `R0.y` to `y`; `x`, `z` are its rotated columns.
9. Result: columns `x * sx`, `y * sy`, `z * sz`, translation `h` (unchanged).

Influence: the foundations' polar blend.

### Limits on the thickness factor

With `m = bulge_max` (when `use_bulge_max` and `f > 1`):

- hard: `min(f, m)`
- soft: `1 + (m - 1) * (2 / pi) * atan((f - 1) / (m - 1))`
- result: `(1 - bulge_smooth) * hard + bulge_smooth * soft`

With `n = bulge_min` (when `use_bulge_min` and `f < 1`):

- hard: `max(f, n)`
- soft: `1 - (1 - n) * (2 / pi) * atan((1 - f) / (1 - n))`
- result: `(1 - bulge_smooth) * hard + bulge_smooth * soft`

So a smooth value above 0 also changes factors inside the limits, not only near them. For `VOLUME_XZX` the limited
`f` is square-rooted afterwards, as the manual says (each axis bound to the square root of the limit). A limit equal
to 1 makes the soft formula divide by zero: treat it as the hard limit (not observed).

## Edge cases

- Target exactly at the owner's head (`d = 0`): Blender produces infinite matrix entries (`target_at_owner`). Leave
  the owner unchanged instead; no file depends on this.
- `rest_length` is per owner and is written once; a later change of distance stretches relative to it.
- For bones the owner is the bone's pose matrix (head at its origin), so the Y axis that stretches is the bone's own
  axis and a stretch of `sy = 1` keeps the bone's rest length only when `rest_length` is the bone's length in owner
  space. Rigify sets `rest_length` explicitly.
