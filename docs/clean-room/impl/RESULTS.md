# Results

Clean-room units: `expression.js`, `driver.js` (with `float32.js` and `rotation-reading.js`), `fcurve.js`. Tests:
`fuzz.mjs <expression|driver|driver-realistic|fcurve> [count] [seed]` runs random cases through the oracle and the
units and writes `mismatches-<unit>.json`; `regress.mjs` replays the spec's recorded probe batches; `replay.mjs`
re-checks a batch saved with `SAVE=<file>`. `final-run.txt` holds the output of the final runs below.

## Acceptance tolerance

A value matches when `|mine - oracle| <= 2e-5 * max(1, |oracle|, |mine|)` (F-Curves: the scale is the largest key
value, at least 1). Measured spread of the matches in float32 steps of max(1, |value|):

| set | 0 | 1 | 2 | 3 | 4 | 5-16 | 17-256 | max |
|---|---|---|---|---|---|---|---|---|
| drivers, random (seed 12) | 75862 | 17906 | 3554 | 991 | 465 | 465 | 27 | 162 steps, 1.7e-5 |
| drivers, realistic (seed 13) | 87973 | 10006 | 1036 | 324 | 270 | 35 | 6 | 110 steps, 1.1e-5 |

The tail above 16 steps comes from long parent chains and shear, where float32 order of operations accumulates.
Expressions use a tighter check (2.5e-7 relative): the result is one float32 rounding of a double computation.

## Final rates

| unit | cases | mismatches | rate | verdict |
|---|---|---|---|---|
| expression | 300,000 (seed 11) | 0 | 0 | robust |
| driver, random | 100,000 (seed 12) | 251 | 0.25% | robust except rotation readings |
| driver, realistic angles | 100,000 (seed 13) | 350 | 0.35% | robust except rotation readings |
| fcurve, all | 100,000 (seed 14) | 7274 | 7.3% | see below |
| fcurve, auto smoothing NONE | 84,756 | 346 | 0.41% | robust except listed edge classes |
| fcurve, CONT_ACCEL | 15,244 | 6928 | 45% | not robust: fall back |

An F-Curve case counts as one mismatch when any handle of any key or any of its 16 to 19 sampled values is off.

### Expressions

Zero mismatches over 300,000 cases. Earlier seeds showed 1 case in 400,000: `cos(floor(pow(1e-40, -2.24)))` and
`tan(clamp(0, exp(54.6), 2e-4))`, where a libm last-bit difference in `pow` or `exp` is amplified by a trig function
of a huge argument (verified: the neighbouring double of `pow` gives the oracle's answer). Not fixable without
Blender's libm; harmless in practice.

Rule found beyond the spec: a variable name longer than 63 characters is cut to 63 (the spec's "64 is python-only"
is the expression no longer matching the cut name).

### Drivers

All driver types, SINGLE_PROP, LOC_DIFF and the LOC_* and SCALE_* channels of TRANSFORMS match in every case. Every
remaining mismatch is a rotation reading (ROT_* channels, ROTATION_DIFF), a branch picked by float32 rounding at a
boundary:

| class | random | realistic | example (oracle vs ours) |
|---|---|---|---|
| sign of pi at a half turn | 73 | 104 | QUATERNION identity with scale (-1,-1,1), XYZ ROT_Z: +pi vs -pi (the quaternion path leaves +0 where the Euler path leaves -0) |
| whole turns in AUTO Euler compatibility | 38 | 102 | object ZXY `rotation_euler` (0,0,3pi), LOCAL_SPACE AUTO ROT_Z: 2pi vs 4pi. The same d = 1.5 turns rounds to 1 here but to 2 for flipped extractions (d7), so the rule depends on more than r - e |
| acos of 1 - 1ulp | 85 | 47 | same object twice in ROTATION_DIFF: 0 vs 0.00069 (or 0.00098); swing W of an exact twist |
| undefined twist at a half turn | 24 | 46 | scale (2.2,-0.3,0.7) under a rotated parent, LOCAL SWING_TWIST_Z ROT_Z: 3.14 vs 0 |
| other rotation readings (combinations of the above in multi-variable drivers) | 26 | 24 | |

Decision with the coordinator: the rotation-reading path falls back to an auto-ported unit. It is one module,
`rotation-reading.js`, with two entry points, `readRotation(n, mode, channel, objectMode, objectEuler)` and
`rotationDifference(a, b)`, both taking column-normalized 3x3 matrices from `driver.js`.

Before the float32 emulation the realistic set mismatched 2.58% and the random set 0.45%. Rules found and now in the
code (beyond or against the spec):

- Object data is stored as float32 first (`rotation_euler` pi is 3.14159274, so `sin` is negative).
- AXIS_ANGLE ignores all delta rotations (the spec covered `delta_rotation_euler` only).
- Matrix to quaternion: the branch is chosen from the diagonal signs (m22 < 0 then m00 > m11, else m00 < -m11), not
  from the trace; this matters once shear is in the matrix. The result is renormalized only when
  |len^2 - 1| >= 0.0006 (measured: 0.000598 raw, 0.000600 normalized; 2000 sheared samples split cleanly).
- Gimbal lock threshold: c = 3.7475e-5 still locks, 3.7952e-5 does not (spec guessed 1.9e-6).
- Singular matrices (zero scale) are inverted after adding 1e-8 to the diagonal (reproduces the spec's LOC_X = 1e8).
- SINGLE_PROP also reads `matrix_world`, `matrix_basis`, `matrix_parent_inverse` (indexed column first) and the
  Empty's scalar defaults (`empty_display_size` 1, `hide_*` 0).
- Float32 order of operations: Euler matrix written out per element; products, normalization (multiply by 1/len),
  atan2, quaternion and swing-twist rounded per operation; quaternion to matrix normalized in float32 and expanded in
  double; ROTATION_DIFF is the w of conj(q1) * q2 in float32.

### F-Curves, auto smoothing NONE (0.41%)

Remaining classes: duplicate frames together with a Cycles modifier (302 of 346; e.g. keys (14,-0.8) and (14,-3.4)
with LINEAR extrapolation and `cycles: true` flatten the AUTO handle, which our rules do not), and near-vertical
handles at the 0.001 limit, where the extrapolation slope or the Bezier root depends on float32 detail
(e.g. value 4.16299 vs 4.16231 with a handle 0.001 from its key).

Rules found beyond or against the spec:

- The 0.001 push lands one float32 step beyond the nearest float32 to key +- 0.001 (key 10 gives 10.001001358).
  A lone key's wrong-way handles move onto the key (no 0.001), and it gets no other recalculation, automatic
  handles included. Handles that are both on the wrong side swap first.
- Auto tangent: each neighbor's direction is scaled by 1 / (its x gap, 0 taken as 1), so the slope is
  (sum of rises / gaps) / (sum of dx / gaps). This is the spec's mean of secants for distinct frames and fixes
  duplicate frames. When the tangent has no x part (neighbors straight above or below) handles stay as they are,
  except that a flat end (CONSTANT extrapolation, both sides automatic) goes flat.
- AUTO_CLAMPED: at an extreme (rises on both sides of opposite sign or zero) only clamped sides go flat; otherwise
  both sides share one slope limited by the AUTO_CLAMPED sides only, and a limit that bites also lays the key's FREE
  or ALIGNED handle on that slope keeping its x.
- ALIGNED pairs: the second turn reuses the lengths measured before the first (visible through float32 rounding).
- Cyclic end keys: if any side of the first or last key is AUTO_CLAMPED, the end pair is clamped. Cycle-aware
  handles are off when the period is 0.
- LINEAR extrapolation: CONSTANT end keys stay flat, LINEAR ones use the secant, every other interpolation (all
  easings too) follows the outer handle. A single key extrapolates along its handle.
- On a frame shared by several keys: the first key at the curve's start, the last at its end, otherwise the key a
  binary search (lo = 0, hi = n, mid = (lo + hi) >> 1) lands on.
- ELASTIC with a negative period: the amplitude fade runs over |P| / 4.

### F-Curves, CONT_ACCEL (45%): not robust

Solved: fully automatic keys of one type (AUTO/AUTO or AUTO_CLAMPED/AUTO_CLAMPED) get handles at a third of the gap
whose slopes make d2y/dx2 of the actual Bezier segments continuous; fixed handles enter by their positions
(this reproduces e.g. 1/7 at an end next to a FREE handle at (7,1)); open ends are natural or pinned flat under
CONSTANT; AUTO_CLAMPED violators are pinned worst first; mixed AUTO/AUTO_CLAMPED keys take the NONE-mode slope at
third lengths; no 0.001 push.

Not solved: a fixed handle on the right of a solved run (FREE (13,4) after key (10,3), gap 4: the oracle's next
slope 2.0667 matches no tested model), a VECTOR side next to an automatic side, ALIGNED next to solved keys,
and cyclic curves with VECTOR or mixed keys. All-automatic curves still miss about 23% (701 of roughly 3000). The
fallback for CONT_ACCEL is the auto-ported unit.

## Open points of the spec, resolved by probing

- Variable name length: cut to 63 characters (expressions).
- Gimbal threshold: 3.77e-5 (drivers).
- LOCAL_SPACE with zero scale: diagonal nudge of 1e-8 before inverting (drivers).
- 0.001 handle limit: one float32 step past the nearest float32 (F-Curves).
- Duplicate frames: tangent rule above; evaluation by binary search (F-Curves).
- AUTO_CLAMPED end keys under LINEAR extrapolation: not clamped in our rules; no remaining mismatch points to it.
- CONT_ACCEL with ALIGNED or mixed keys: partly resolved, see above.

## Files

- `expression.js`, `driver.js`, `float32.js`, `rotation-reading.js`, `fcurve.js`: the units.
- `fuzz.mjs`, `fuzz-*.mjs`, `fuzz-random.mjs`, `ask-oracle.mjs`, `regress.mjs`, `replay.mjs`, `show.mjs`: tests.
- `probes/`: targeted oracle probes (`*.json` requests, `try.mjs`, `fc.mjs`), the minimizer (`minimize.mjs`,
  `minshow.mjs`), analysis scripts, and `patch-smooth.cjs` / `smooth-section.js` (edit scripts used once).
