# Drivers: driver types and variable types

Behavior of a Blender driver on objects (Empties), confirmed against the oracle. Probe files: `probes/dN.mjs`
(builder), `dN.req.json`, `dN.res.json`; `d4.txt` holds the printed d4 table. Helper math used only to check
hypotheses is in `probes/m.mjs`, `m2.mjs`, `chk_euler.mjs`. The expression language itself is in `expressions.md`.

Conventions in this document: matrices act on column vectors, `M[row][col]`, translation in the last column. A 4x4
given as "4 rows of 4" (as `matrix_parent_inverse` in the oracle) is read row by row in that convention (d6
`pinv_rot`). Angles in radians. `f32(x)` is rounding to the nearest float32.

## 1. Driver evaluation

1. Each variable is evaluated to a number (section 3), then rounded to float32.
2. The driver type combines them (section 2).
3. The driver's value is a float32; a non-finite value is kept as ±FLT_MAX (3.4028234663852886e38) for the
   AVERAGE/SUM/MIN/MAX types (d1 `SUM [3e38 x3]` = FLT_MAX, `AVERAGE [3e38 x3]` = FLT_MAX; d12 property 1e39 read by
   SUM gives FLT_MAX). A SCRIPTED expression whose result is NaN or ±inf is an error instead and keeps the previous
   value (0 for a new driver), see `expressions.md` section 6.

### Validity

A variable is invalid when a target it needs has no object, its data path does not resolve (missing custom property,
index out of range, an array property without an index, an empty or malformed path), or a two-target variable has one
target missing. An invalid variable's value is 0 and it still takes part in the driver (it is counted by AVERAGE,
compared by MIN/MAX). The driver is then marked invalid (`valid: false`) but still produces a value, even for a SCRIPTED
expression that does not use that variable (d1 `SCRIPTED unused noobj` = 5, invalid; d1, d2, d10, d12).

## 2. Driver types

With variable values v1 ... vn (float32), in variable order:

| type | value | evidence |
|---|---|---|
| AVERAGE | float32 running sum s = f32(s + vi), then f32(s / n); n = 0 gives 0 | d1 [2,5,-1] = 2, [2, invalid] = 1; d2 [1e8,1,-1e8] = 0 (float32 sum), [0.7,0.1,0.1] = 0.30000001192092896 |
| SUM | float32 running sum in variable order; n = 0 gives 0 | d2 [1e8,1,-1e8] = 0, [0.7,0.1,0.1] = 0.9000000357627869, [3e38,3e38,-3e38] = FLT_MAX (inf on the way) |
| MIN | smallest value; n = 0 gives 0 | d1, d2 [3, invalid, -2] = -2, [-3, invalid] = -3 |
| MAX | largest value; n = 0 gives 0 | d2 [-3, -5] = -3 (no implicit 0 start), [-3, invalid] = 0 |
| SCRIPTED | the expression with variables bound by name (expressions.md) | d1 |

SCRIPTED details:

- A variable's name only matters to SCRIPTED. A variable with a name the evaluator cannot accept (`1a`) makes the
  expression python-only only if the expression uses it (d1 `bad name var` python-only, `bad name var unused` = 3);
  AVERAGE etc. ignore names (d1 `AVERAGE bad name var` = 3).
- A variable named `frame` replaces the frame (d1 = 2 at frame 9).
- An empty expression with no variables gives 0; `"1"` with no variables gives 1.

## 3. Variable types

### SINGLE_PROP

Reads the property at `data_path` on the target object, as stored (no parent, no deltas, no constraints applied):

- `location[i]`, `scale[i]`, `rotation_euler[i]` (raw, `4` stays 4), `rotation_quaternion[i]` (raw, not normalized:
  `[2,0,0,0]` gives 2), `rotation_axis_angle[i]`, `delta_location[i]`, `delta_scale[i]`, custom properties `["name"]`
  and `["name"][i]` (d1, d12).
- Booleans read as 0/1, a string property (`name`) reads as 0 and is valid (d1).
- Errors (invalid, value 0): index out of range (`location[3]`, `location[-1]`, `["p"][5]`), an array without index
  (`location`, `["p"]` on an array), a missing custom property, an empty or malformed path (d1, d12).
- The value passes through float32 (custom property 0.1 reads as 0.10000000149011612; 1e39 becomes inf).
- `transform_space` is ignored.

### TRANSFORMS (Transform Channel)

Reads one channel of a matrix chosen by `transform_space`, decomposed as below. Defaults when a field is absent:
`transform_type` LOC_X, `transform_space` WORLD_SPACE, `rotation_mode` AUTO (d10).

**Object matrices.** For an object with location L, rotation R (a 3x3 rotation, below), scale S and deltas:

- Basis (own) matrix B = T(L + ΔL) · Rtot · diag(S ⊙ ΔS), where ⊙ is per-component product (d3 `delta`: location
  (1,2,3) + (10,20,30) = (11,22,33), scale (2,3,4) ⊙ (2,1,1) = (4,3,4)).
- Rtot = Rdelta · Rrot (the delta rotation is applied after the rotation, i.e. on the parent side), with
  - Euler modes: Rrot = Euler(rotation_euler, order), Rdelta = Euler(delta_rotation_euler, same order);
    `delta_rotation_quaternion` is ignored (d6 `dE`, `dEzyx`, `E_dQ`).
  - QUATERNION: Rrot from `rotation_quaternion` normalized, Rdelta from `delta_rotation_quaternion` normalized;
    `delta_rotation_euler` is ignored (d6 `dQ`, `dQ_E`; d4 `quatun` [2,0,0,0.5] reads as normalized).
  - AXIS_ANGLE: rotation by angle about the normalized axis; axis (0,0,0) gives identity; `delta_rotation_euler` is
    ignored (d6 `AA`, `AA0`, `AAunnorm`).
- Euler order "ABC" (XYZ, XZY, YXZ, YZX, ZXY, ZYX) applies A first: Euler((x,y,z), ABC) = R_C · R_B · R_A, with
  R_X(a), R_Y(a), R_Z(a) the right-handed rotations about the axes (checked by recomposing every oracle decomposition
  in `chk_euler.mjs`, error < 2e-7).
- World matrix W = Wparent · P · B, where P is `matrix_parent_inverse` (identity by default) and Wparent the parent's
  world matrix; no parent: W = B (d3 `parented`, d6 `pinv_rot`, `gp`).

**Spaces.** The matrix M that is decomposed:

| space | M |
|---|---|
| WORLD_SPACE | W |
| TRANSFORM_SPACE | B (own transform with deltas, no parent) (d3, d6 `par_rot_neg`) |
| LOCAL_SPACE, with a parent | (Wparent · P)^-1 · W, which equals B (d3 `parented`, `parinv`; d6 `pinv_rot`, `par_rot_neg`, `gp`) |
| LOCAL_SPACE, no parent | N^-1 · B, where N is B's 3x3 with each column divided by its length (sign kept). The result has no rotation, its scale is the column lengths, and its translation is N^-1 (L + ΔL). |

Evidence for the no-parent LOCAL rule: d3 `plain` LOCAL location (0.9195443, 1.9312844, 3.0699475) = R^T (1,2,3) for
R = Euler(0.1,0.2,0.3) (computed in `m.mjs`), rotation ~0, scale (2,3,4); d3 `delta` LOCAL location (11, 30.7696,
25.0247) = R_X(-0.3) (11,22,33); d6 `np_neg` (scale (-2,3,4), location (1,2,3)) gives location (-1,2,3), scale
(2,3,4), SCALE_AVG +2.884; d6 `np_neg_rot` matches R_Z(0.5)·diag(-1,1,1) inverted; d12 LOC_DIFF in LOCAL between an
object at (1,0,0) rotated 90 degrees about Z and one at (0,-1,0) is 0.

**Decomposition of M** (its 3x3 part A and translation t):

- LOC_X/Y/Z: t.
- SCALE_X/Y/Z: the length of column 0/1/2 of A (always ≥ 0, even for negative scale) (d3 `negscale*`).
- SCALE_AVG: the signed cube root of det(A) (d3 `plain` cbrt(24) = 2.8844991; negative det gives a negative value:
  `negscale` -2.884, `negscale2` (two negative axes) +2.884; d6 `shear` cbrt(6) = 1.8171206; zero scale gives 0).
  In the no-parent LOCAL space this is always ≥ 0 (det of N^-1 B is the product of the lengths).
- Rotation channels use N = A with each column divided by its length. N is not orthogonalized (shear stays in it)
  and not sign-corrected for a negative determinant, except for the quaternion step below.

**Rotation modes** (`rotation_mode` of the target; ROT_X, ROT_Y, ROT_Z, ROT_W pick a component):

- **Euler order (XYZ ... ZYX)**: ROT_X/Y/Z are the Euler angles of N for that order, ROT_W = 0. Extraction for the
  order "ABC" with axis indices i = A, j = B, k = C (X = 0, Y = 1, Z = 2), so N = R_k(a_k) R_j(a_j) R_i(a_i), and parity
  p = +1 for XYZ, YZX, ZXY and p = -1 for XZY, YXZ, ZYX:
  - c = sqrt(N[i][i]^2 + N[j][i]^2).
  - If c is not tiny: solution 1: a_i = atan2(p N[k][j], N[k][k]), a_j = atan2(-p N[k][i], c),
    a_k = atan2(p N[j][i], N[i][i]); solution 2: a_i = atan2(-p N[k][j], -N[k][k]), a_j = atan2(-p N[k][i], -c),
    a_k = atan2(-p N[j][i], -N[i][i]). The result is solution 2 only if its |a_i| + |a_j| + |a_k| is strictly
    smaller (d4 `e6`: Ry(2) gives y = 2, not 1.1416 with x = z = pi; e5 XZY middle angle 1.642 > pi/2).
  - If c is tiny (gimbal lock): a_i = atan2(-p N[j][k], N[j][j]), a_j = atan2(-p N[k][i], c), a_k = 0 (d4 `quat` XYZ
    gives (pi/2, -pi/2, 0)).
  - `chk_euler2.mjs` implements exactly this and matches all 42 d4 order/rotation readings (worst 2.1e-7) and 400
    random XYZ readings of d8 (worst 2.4e-7, ignoring the ±pi sign cases); `chk_euler.mjs` checks recomposition.
  - Applied to a matrix with a negative determinant this gives the angles of the sign-kept columns: d6 `par_rot_neg`
    (scale (-1,2,2), rotation (0.1,0.2,0.3)) reads (0.1, -0.2, 0.3 - pi).
- **AUTO**: if the object uses an Euler rotation mode, its own order is used and the result is made compatible with
  the object's `rotation_euler` (not including the delta rotation; d10 `rot0 delta3.5` = -2.783, `rot3.5` = 3.5).
  If the object uses QUATERNION or AXIS_ANGLE, AUTO is plain XYZ (d4 `quat`, `quatneg`, `aa`). The compatibility rule,
  per axis, with e the extracted angle and r the reference angle, in float32:
  - d = r - e. If |d| ≤ f32(pi): keep e. Otherwise e + 2 pi k, with k = round half away from zero of f32(d / f32(2 pi)).
  - Evidence: d5, d7, d8 (1500 random references): every non-tie case equals the nearest equivalent of the reference;
    the ties (an Euler flip makes the first and third axes differ by an odd multiple of pi) resolved as
    d = ±0.5 turn: k = 0; ±1.5: ±2; ±2.5: ±3; ±3.5: ±3 (every one of 60 to 120 cases per row), which is what the
    float32 rule above gives (f32(7 pi) / f32(2 pi) = 3.4999998). d9: d = 3.1415938 (just above f32(pi)) already
    shifts. Unflipped readings return the reference exactly (`[10,0.3,-8]` gives 10, 0.3, -8; `[7,0,0]` gives 7).
  - The same AUTO reference is used in every space, so with a rotated parent the world reading is near the object's
    own angles plus the parent's (d5 `parentRot` WORLD AUTO = 4.5); in the no-parent LOCAL space the extracted
    rotation is 0, so AUTO returns the multiple of 2 pi nearest the object's angle (d5 `deltaE` LOCAL AUTO = 2 pi
    for rotation_euler 4).
- **QUATERNION**: ROT_W, ROT_X, ROT_Y, ROT_Z are the components of q(N), computed as:
  1. if det(N) < 0, negate N (d11 `negx`: scale (-1,1,1) gives (0,1,0,0), i.e. 180 degrees about X);
  2. t = N[0][0] + N[1][1] + N[2][2]; if t > 0: s = 2 sqrt(1 + t), q = (s/4, (N[2][1]-N[1][2])/s,
     (N[0][2]-N[2][0])/s, (N[1][0]-N[0][1])/s); else take the largest diagonal entry i and use the matching textbook
     branch (for i = 0: s = 2 sqrt(1 + N00 - N11 - N22), q = ((N21-N12)/s, s/4, (N01+N10)/s, (N02+N20)/s); i = 1 and 2
     likewise);
  3. normalize q, then negate it if w < 0.
  This matches the oracle for orthonormal, negative-determinant and sheared matrices, including negative traces
  (d11 hyp lines vs oracle: `shear_neg_tr`, `shear_b`, `shear_c`, `shear_d`, `negx_rot`, all to 1e-6; d6 `shear`).
- **SWING_TWIST_X/Y/Z** (twist axis a): with q = q(N) from the QUATERNION rule (w ≥ 0):
  - twist angle τ = 2 atan2(q_a, q_w); twist quaternion t = (q_w, q_a on axis a) / sqrt(q_w^2 + q_a^2);
  - swing s = q · conj(t), so q = s · t (twist applied first);
  - ROT_W = 2 acos(s_w); for each axis b ≠ a: ROT_b = 2 asin(s_b); ROT_a = τ.
  - Evidence: d4 `e5`, `e7` all three axes match this to 1e-6 (`m2.mjs` variant A; the other product order fails);
    d4 `e4`, `e6`, `aa`, `quat`.
- Components not listed (ROT_W in Euler modes) read 0.

**Float32 effects worth copying.** Blender computes these in float32. Near-identity swings and differences pass
through `acos` of a float32 near 1: d4 `e4` SWING_TWIST_X ROT_W = 0.00069 instead of 0, d6 `pi_sw` signs of ±pi follow
float32 cos(pi/2) < 0. Exact ±pi results from a zero entry have a sign that depends on the sign of that zero (d3
`negscale` ROT_Z = -pi, d6 `dS_neg` the same matrix built from a delta scale gives +pi); both are the same rotation.

### LOC_DIFF (Distance)

Two targets; each is read in its own `transform_space` (default WORLD_SPACE); the value is the Euclidean distance
between the two positions (d10, d12):

| space | position |
|---|---|
| WORLD_SPACE | translation of W |
| TRANSFORM_SPACE | the `location` property only: no delta_location, no parent (d10 `delta` TRANSFORM = 1, `parent` TRANSFORM = 1; d11 `loc_diff transform delta` = 1). This differs from TRANSFORMS in TRANSFORM_SPACE, which includes the delta (d12). |
| LOCAL_SPACE | the translation of the LOCAL_SPACE matrix above (with parent: L + ΔL; without: N^-1 (L + ΔL)) (d12 `local parented delta` = sqrt(5), `local rotated pair` = 0) |

The two targets may use different spaces (d10 `mixed` = 11). The same object twice gives 0. A missing target or
object: invalid, 0.

### ROTATION_DIFF

Two targets; `transform_space` is ignored (d10 `space ignored` = 1.5 = world difference). With q1 = q(N1), q2 = q(N2)
from the world matrices by the QUATERNION rule (scale and shear removed by column normalization, det < 0 handled by
negation), the value is the angle of q1^-1 · q2: 2 acos(|w|) with w the scalar part, computed in float32 (d10: Z 1 rad
gives 1, -1 gives 1, 4 gives 2.2832 = 2 pi - 4, pi gives 3.1415925, X1 vs Y1 gives 1.3834366, parent rotation adds,
location ignored; d11 `negx_rot` 2.8534524 = 2 acos(0.1435722)). Float32 rounding of w makes tiny angles collapse:
rotation 1e-4 gives 0, 1e-3 gives 0.0009765625 (d10).

## Open points

- LOCAL_SPACE without a parent and a zero scale on an axis: the normalization divides by zero; the oracle returned
  LOC_X = 1e8 (d6 `zero_scale`). Not modeled.
- The exact float32 operation order inside matrix building and decomposition is not knowable from outside; results
  match to about 1e-7 relative, except at the exact-pi sign cases and acos near 1 noted above.
- The rotation mode AUTO on an Euler object whose matrix has a negative determinant was not specifically probed.
- Constraints are not exposed by the oracle, so the difference between TRANSFORM_SPACE (before constraints) and
  LOCAL_SPACE (after, relative to the parent) that the names suggest could not be observed; with a parent they are equal
  here.
- The "c is tiny" threshold for gimbal lock was not measured; `chk_euler2.mjs` uses 16 x float32 epsilon (1.9e-6),
  which reproduces the one exactly locked case probed (d4 `quat`).
- Bones (pose channels) are not exposed by the oracle; everything here is for objects.
