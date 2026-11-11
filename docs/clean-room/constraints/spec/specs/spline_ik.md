# Spline IK (`SPLINE_IK`)

Not used by any counted file; specified because the brief asks for it. Manual:
https://docs.blender.org/manual/en/latest/animation/constraints/tracking/spline_ik.html

Fixtures: `spline_ik.fixtures.json` (32 cases, `gen/spline_ik.py`: a 4-bone chain with equal and unequal bone
lengths on a poly curve and a 2-point Bezier curve with radius and tilt, every fitting and scaling option). The
checks below were made on the poly-curve cases with inline scripts recorded in the log; the Bezier cases are
fixtures only.

## Settings

| Property | Default | Values |
|---|---|---|
| `target` | none | a curve object (`use_path` on) |
| `chain_count` | 1 | bones from the owner up its parents |
| `use_even_divisions` | false | |
| `use_chain_offset` | false | |
| `use_curve_radius` | true | |
| `y_scale_mode` | `FIT_CURVE` | `NONE`, `FIT_CURVE`, `BONE_ORIGINAL` |
| `xz_scale_mode` | `NONE` | `NONE`, `BONE_ORIGINAL`, `INVERSE_PRESERVE`, `VOLUME_PRESERVE` |
| `use_original_scale` | true | |
| `bulge`, `use_bulge_min`, `use_bulge_max`, `bulge_min`, `bulge_max`, `bulge_smooth` | 1, false, false, 1, 1, 0 | as Stretch To |
| `influence` | 1.0 | |

Like IK it runs after the chain bones' other constraints, whatever its place in the stack (manual).

## Behaviour found (poly curve, chain head at the curve start)

- `FIT_CURVE`: the chain's joints (each bone's head, and the last bone's tail) lie on the curve at arc-length
  fractions `0, c1, c2, ..., 1` of the curve, `ck` the cumulative rest length share (equal shares with
  `use_even_divisions`). Exact to 1e-4.
- `NONE` and `BONE_ORIGINAL` (bones keep their length): the joints still lie on the curve. The first is at the curve
  start; each next one is where the curve is at straight-line distance equal to the bone's length from the previous
  joint (chord stepping, so a corner shortens the arc used).
- Each bone's Y axis is the chord from its head to the next joint (exact).
- Y scale in `FIT_CURVE`: chord length / rest length. In `NONE`: 1.
- `INVERSE_PRESERVE`: X and Z scale `1 / sy`. `VOLUME_PRESERVE` with `bulge` 1: `1 / sqrt(sy)`. `NONE`: 1.
  (Poly cases, exact to the 3 decimals checked.)

## Open

- Roll of each bone about its chord (curve tilt and twist minimization): not fitted; compare with the fixtures.
- Curve evaluation for Bezier and NURBS splines (resolution, radius interpolation, tilt): fixtures only.
- `use_chain_offset`, `use_curve_radius`, the bulge limits and `use_original_scale`: fixtures only (the poly cases
  start at the chain head, so offset made no difference there).
- How the chain's root position is taken when the curve does not start at the chain head.
