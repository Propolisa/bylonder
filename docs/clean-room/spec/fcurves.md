# F-Curve evaluation

Behavior of Blender's F-Curve evaluation and handle recalculation, confirmed against the oracle. Probe files:
`probes/fN.mjs` (builder), `fN.req.json`, `fN.res.json`; fitting scripts `fit_*.mjs`. Where a rule is stated as a
formula, the named fit script implements exactly that formula and its error against the oracle is quoted.

Notation: a keyframe k has `co` = (x_k, y_k), left handle (lx_k, ly_k), right handle (rx_k, ry_k), interpolation,
easing, handle types. Keyframe coordinates, handles, times and results are float32.

## 1. Order of work

1. Keys are sorted by frame (f5 `unsorted`). Keys on the same frame keep their order.
2. Handles are recalculated (sections 5 and 6).
3. The curve is evaluated at each time (sections 2 to 4), with the Cycles modifier (section 7) mapping the time first.

An F-Curve with no keys evaluates to 0; one key gives its value everywhere (f6, f15).

## 2. Which rule applies at time t

With keys sorted x_0 ≤ ... ≤ x_n:

- t < x_0 or t > x_n: extrapolation (section 4).
- t equal to a key's frame: that key's value (f6: CONSTANT at 10 gives 5, LINEAR at 10 gives 5).
- otherwise t lies in the segment from key k to key k+1 (x_k < t < x_(k+1)), evaluated with key k's `interpolation`
  (and its easing and BACK/ELASTIC settings). The last key's interpolation only matters for extrapolation.
- Two keys on the same frame: at that frame the first one's value, after it the segment starting at the second one
  (f15: keys (1,0), (1,5), (3,1) give 0 at 1 and 4 at 1.5).

Within a segment let d = x_(k+1) - x_k, τ = t - x_k, p = τ / d, b = y_k, c = y_(k+1) - y_k.

## 3. Interpolation modes

- **CONSTANT**: b for the whole segment (t = 9.999 gives the left value, f6).
- **LINEAR**: b + c p.
- **BEZIER**: section 3.2.
- **Easing modes**: b + c E(p) for SINE, QUAD, CUBIC, QUART, QUINT, EXPO, CIRC, BACK, BOUNCE; ELASTIC in section 3.1.
  `easing` AUTO means EASE_IN for SINE, QUAD, CUBIC, QUART, QUINT, EXPO, CIRC and EASE_OUT for BACK, BOUNCE, ELASTIC
  (f1: each AUTO row equals the IN or OUT row exactly). For LINEAR and CONSTANT the easing is ignored.

### 3.1 Easing functions

Each mode has an "in" function I(p) on [0, 1]; then

- EASE_IN: E(p) = I(p)
- EASE_OUT: E(p) = 1 - I(1 - p)
- EASE_IN_OUT: E(p) = I(2p) / 2 for p < 0.5, else 1 - I(2 - 2p) / 2

| mode | I(p) | evidence |
|---|---|---|
| SINE | 1 - cos(p pi / 2) | f1, error ≤ 7e-7 for all three easings |
| QUAD | p^2 | f1 |
| CUBIC | p^3 | f1 |
| QUART | p^4 | f1 |
| QUINT | p^5 | f1 |
| CIRC | 1 - sqrt(1 - p^2) | f1 |
| EXPO | (2^(10(p - 1)) - 2^-10) / (1 - 2^-10), so that I(0) = 0 exactly (Penner's form without the rescale is off by 4.9e-3) | `fit_misc.mjs` on f2, error ≤ 4.7e-7 |
| BACK | p^2 ((s + 1) p - s) with s = `back` (default 1.70158); EASE_IN_OUT uses s' = 1.525 s in both halves | `fit_misc.mjs`: s = 1.70158, 0, 3, -1, error ≤ 1.1e-6 (plain s in the in-out fails by 0.33) |
| BOUNCE | 1 - B(1 - p), with B(q) = 7.5625 q^2 for q < 1/2.75; 7.5625 (q - 1.5/2.75)^2 + 0.75 for q < 2/2.75; 7.5625 (q - 2.25/2.75)^2 + 0.9375 for q < 2.5/2.75; else 7.5625 (q - 2.625/2.75)^2 + 0.984375 | f1, error ≤ 3.8e-7 |

These are Robert Penner's easing equations, except for the EXPO rescale.

**ELASTIC** (value form; a = `amplitude` default 0.8, P = `period` default 4.1, in frames). At τ ≤ 0 the value is b,
at τ ≥ d it is b + c. Otherwise, with the deviation function D(u) for 0 ≤ u ≤ d:

- If P = 0, use P = 0.3 d for EASE_IN and EASE_OUT and P = 0.45 d for EASE_IN_OUT.
- ω = 2 pi / P.
- If a < |c|: s = P / 4, and the effective amplitude fades in over the first quarter period:
  A(u) = a + (|c| - a)(1 - u / s) for u < s, A(u) = a otherwise; D(u) = sign(c) A(u) 2^(-10 u / d) sin(ω (u + s)).
- Otherwise (a ≥ |c|): s = P / (2 pi) asin(c / a); D(u) = a 2^(-10 u / d) sin(ω (u + s)).
- EASE_OUT: b + c - D(τ)
- EASE_IN: b + D(d - τ)
- EASE_IN_OUT: b + D(d - 2τ) / 2 for τ < d / 2, else b + c - D(2τ - d) / 2

Evidence: `fit_elastic2.mjs` over f2 (amplitudes 0.8, 0, 10, 5, 4.99, 20, 1; periods 4.1, 1, 0, 2, 10; durations
4, 10, 20; c = 5, -5, 1, 30; all easings): worst error 4.2e-6 relative to |c|. f16: c = 0 with a = 0.8 still
oscillates (EASE_IN at τ = 9 gives 3.3997 for b = 3); c = 0 with a = 0 is flat; negative amplitude and negative period
follow the same formulas (f16 rows 6 and 7). The fade for a < |c| is Blender's own (plain Penner sets a = |c|); a = 0
gives a curve that settles within a quarter period (f2 `amp 0`).

### 3.2 Bezier segments

Control points P0 = (x_k, y_k), P1 = (rx_k, ry_k), P2 = (lx_(k+1), ly_(k+1)), P3 = (x_(k+1), y_(k+1)), after handle
recalculation (section 5).

1. **Overshoot correction, per handle** (`fit_bez.mjs`, f13): with d = x_(k+1) - x_k, l1 = rx_k - x_k,
   l2 = x_(k+1) - lx_(k+1): if l1 > d, P1 is pulled toward P0 by the factor d / l1 (both coordinates, so its x
   distance becomes d); likewise P2 toward P3 by d / l2 if l2 > d. Handles that cross each other but stay within the
   segment are not changed (f3 case h0 = (8,5), h1 = (2,-2) matches only without correction; f13 asymmetric cases
   (15,5)/(8,-2), (25,5)/(-5,-2), (3,5)/(-20,8): error ≤ 4.7e-6). A uniform "scale both if l1 + l2 > d" rule fails
   (error 0.45).
2. Solve x(u) = t for u in [0, 1], where x(u) = (1-u)^3 x0 + 3(1-u)^2 u x1 + 3(1-u) u^2 x2 + u^3 x3 (monotone after
   step 1), then the value is y(u) with the same weights. A double-precision bisection reproduces the oracle to
   ≤ 5e-6 (f3, f13).

## 4. Extrapolation

`extrapolation` CONSTANT: before the first key the first key's value, after the last key the last key's value.

`extrapolation` LINEAR (f6), before the first key (key 0) and symmetrically after the last key (key n):

- If that end key's `interpolation` is CONSTANT: flat (f6 `LINEAR constant interp`, `constant last`).
- If it is BEZIER: a straight line through the key along its outer handle: slope (y_0 - ly_0) / (x_0 - lx_0) before
  the start, (ry_n - y_n) / (rx_n - x_n) after the end (f6 `free handles`: left handle (-2,3) gives 15 at -10, right
  handle (21,4) gives 22 at 30). A handle with zero x length has already been moved 0.001 out (section 5.1), giving a
  steep line (f6 `vertical-ish handle`: 29999.996 at -10).
- Any other interpolation: the slope of the line through the two end keys (key 0 and 1, or n-1 and n)
  (f6 `linear interp` -5 at -10 for slope 0.5; `elastic first` likewise; `first linear last bezier` uses the
  secant at the start and the handle at the end).
- Two keys on the same frame give slope 0 (f15).

With a Cycles modifier (section 7) extrapolation only shows beyond the cycle counts.

## 5. Handle recalculation

### 5.1 Handles that point the wrong way

For every key, a right handle with x < x_k + 0.001 is moved to x = x_k + 0.001, and a left handle with
x > x_k - 0.001 to x_k - 0.001, keeping its y (f3: (-2,5) and (0,5) become (0.001,5); f5 `free right x`: 10.0005,
10.001 and 9.9 become 10.001001, 10.002 stays; `free left past` (11,2) becomes (9.998999,2)). This happens before
ALIGNED alignment (f5 `aligned past`). The exact float32 threshold at 0.001 itself is an open point.

### 5.2 Handle types (auto smoothing NONE)

Each side of a key is computed from its own handle type; the two sides are independent unless one is ALIGNED
(f5 `mix ...`).

**FREE**: kept as given.

**VECTOR**: one third of the way to the neighbor key on that side: left = co + (prev - co) / 3,
right = co + (next - co) / 3. At an end without a neighbor, the missing neighbor is the mirror of the other one
(co - (next - co)), so the end handle points away along the same line (f4 `VECTOR` rows; f5 `vector ends`). A single
key has both handles on the key (f4 `1 key`).

**AUTO and AUTO_CLAMPED** (`f14.mjs` reimplements exactly the steps below and matches 300 random curves of 2 to 7
keys, with gaps up to 30 frames, both extrapolations and both types, worst relative error 1.4e-6):

1. Neighbors: prev = key k-1 and next = key k+1. A missing neighbor (end key) is the mirror of the existing one
   through the key: prev = 2 co - next or next = 2 co - prev. (Cyclic curves: section 7.1.)
2. Distances in x only: da = x_k - prev_x, db = next_x - x_k; a distance of 0 is taken as 1 (f5 `duplicate frames`).
3. Slope m = (sa + sb) / 2, the mean of the two secant slopes sa = (y_k - prev_y) / da and
   sb = (next_y - y_k) / db (f4 `3 keys`: secants 0.5 and -0.6 give -0.05; Euclidean-length weighting gives -0.038 and
   is wrong).
4. Handle x lengths: limit each distance to 5 times the other (da = min(da, 5 db), db = min(db, 5 da)), then
   ha = da / 2.5614 and hb = db / 2.5614 (f5 `const 1000`: 390.4115 for a gap of 1000; `ratio 4.9` keeps 4.9,
   `ratio 5.1` gives 5/2.5614; `ratio 7 other side`; f4 `4 keys uneven`).
5. End keys: if the curve's extrapolation is CONSTANT and both handle types of the end key are AUTO or AUTO_CLAMPED,
   m = 0 (flat). With LINEAR extrapolation, or when the other handle of the end key is not automatic, m stays the
   secant slope from step 3 (f5 `ends LINEAR`, f9 `first left FREE right AUTO` gives slope 0.75 on the AUTO side).
6. AUTO_CLAMPED, interior keys only: let A = (y_k - prev_y) / ha and B = (next_y - y_k) / hb (the slopes that put a
   handle exactly at the neighbor's value). The allowed range is [lo, hi] with lo = max(min(0, A), min(0, B)),
   hi = min(max(0, A), max(0, B)); if lo > hi (the key is a local extreme, or equal to a neighbor) m = 0, else m is
   clamped into [lo, hi]. In words: neither handle may pass its neighbor's value or turn back past the key's own
   value, and both sides keep one common slope (f5 `clamp both`, `clamp left only`, `clamp right only`,
   `clamp decreasing`, `clamp equal prev`; f4 `slight`: 9.5 / 10.5).
7. left handle = (x_k - ha, y_k - ha m), right handle = (x_k + hb, y_k + hb m).

A key with AUTO on one side and AUTO_CLAMPED on the other uses the clamped slope only on the clamped side (f5
`mix AUTO_CLAMPED/AUTO`: left flat at an extreme, right unclamped). Handle positions given in the request are ignored
for automatic types (f5 `auto with given handles`).

**ALIGNED**: the handle is turned to point exactly opposite the other handle of the same key, keeping its own
Euclidean length |handle - co| (2D, in frame and value units). The other handle is first computed by its own type.
When both handles are ALIGNED, the left one turns to match the right one, unless the left handle is selected
(`select[0]`), in which case the right one turns to match the left one; the key's and right handle's selection do not
matter (f5 `aligned sel` rows: only `select[0]` decides). ALIGNED paired with FREE: both stay as given (f5
`mix ALIGNED/FREE`, `FREE/ALIGNED`). ALIGNED paired with AUTO or VECTOR: the ALIGNED side turns opposite the computed
side (f5 `mix ALIGNED/AUTO` (5.006238, 5.249688), `mix AUTO/ALIGNED`, `mix ALIGNED/VECTOR`, `mix VECTOR/ALIGNED`).

### 5.3 Auto smoothing CONT_ACCEL

With `auto_smoothing` CONT_ACCEL (f10, f11, f12):

- Automatic handles have x length (distance to the neighbor) / 3, with no 5x limit, so every segment between automatic
  keys is a cubic in time; the slopes m_k are solved so the second derivative is continuous at each automatic key:
  m_(k-1)/h_(k-1) + 2 m_k (1/h_(k-1) + 1/h_k) + m_(k+1)/h_k = 3 ((y_k - y_(k-1))/h_(k-1)^2 + (y_(k+1) - y_k)/h_k^2),
  h_k = x_(k+1) - x_k. (`fit_accel.mjs` solves this; f11 AUTO slopes match to 5 decimals.)
- End keys: with CONSTANT extrapolation (and both handles automatic) m = 0; with LINEAR extrapolation a natural end,
  2 m_0 + m_1 = 3 (y_1 - y_0)/h_0 and m_(n-1) + 2 m_n = 3 (y_n - y_(n-1))/h_(n-1) (f10 `s3 AUTO LINEAR`).
- A FREE key is a fixed slope taken from its handles (f10 `s5 mid FREE`: neighbors solve to 1.5 and -0.5 with that key
  fixed at -1).
- A VECTOR key splits the system: each side is solved separately with a natural end at the VECTOR key, and that key's
  handles get the resulting slopes at x length / 3 (f10 `s5 mid VECTOR`: (5, 3.42857) and (7, 3.71429) are slopes
  11/7 and -9/7 from natural splines on each side).
- AUTO_CLAMPED: solve; if any automatic key's slope lies outside its allowed range [lo, hi] (step 6 above, with
  ha, hb = x length / 3; ends 0 under CONSTANT extrapolation), take the single key with the largest violation, fix it
  at its clamped value, and solve again; repeat until no key violates. This matches all 120 random curves of f12
  (`f12b.mjs` `worstFirst`); clamping all violators at once, or clamping only after one solve, mismatches 22 to 104
  of them.
- Cyclic curves (section 7.1): the system wraps around with the cross-cycle neighbors of 7.1, first and last key
  sharing one slope (`chk_cycles.mjs` solves the periodic system and matches the four f10 `AUTO cyclic` curves with
  3 or more keys to 5e-6).

## 6. Selection

Selection only affects ALIGNED handles (section 5.2).

## 7. Cycles modifier

Period L = x_n - x_0, value change V = y_n - y_0. `cycles: true` means mode_before = mode_after = REPEAT and
cycles_before = cycles_after = 0 (unlimited) (f7 `true` equals `REPEAT 0`).

For t > x_n: i = ceil((t - x_n) / L) (so t = x_n + L maps to the end, not the start: f7 `true` at 40 gives the value at
x_n). If mode_after is NONE, or cycles_after > 0 and i > cycles_after, the plain curve is evaluated at t (with its
extrapolation; f7 `REPEAT 1 linear extrap`). Otherwise t' = t - i L, and

- REPEAT: value(t')
- REPEAT_OFFSET: value(t') + i V
- MIRROR: for odd i, t' = x_n - (t - x_n - (i - 1) L) (time reflected), value(t'); for even i as REPEAT.

For t < x_0, the same with i = ceil((x_0 - t) / L), t' = t + i L, REPEAT_OFFSET subtracts i V, MIRROR reflects odd i
as t' = x_0 + (x_0 - t - (i - 1) L), and mode_before / cycles_before apply. Each side has its own mode and count
(f7 `mixed`). Evidence: f7, a LINEAR test curve with keys (0,0), (4,3), (10,1) sampled every 0.75 frames from -35 to
40 under 17 settings; `chk_cycles.mjs` implements exactly these rules and matches all 1717 samples (spot checks:
REPEAT_OFFSET at 13 gives 3.25, at -20 gives -2; MIRROR at 13 gives 2, at -23 gives 2.25).

With a single key (L = 0) the curve is constant (f15).

### 7.1 Cycle-aware automatic handles

When both modes are REPEAT or REPEAT_OFFSET with both counts 0 (f8: MIRROR, a count of 1, or NONE on one side turn it
off), and both handles of the first and of the last key are AUTO or AUTO_CLAMPED (f9: VECTOR, ALIGNED or FREE on any
of these four handles turns it off for both ends; interior keys and interpolation modes do not matter), the end keys
get neighbors across the cycle, always with the value offset (also for plain REPEAT, f8 `AUTO true` equals
`AUTO REPEAT_OFFSET`):

- prev of key 0 = (x_(n-1) - L, y_(n-1) - V); next of key n = (x_1 + L, y_1 + V);
- then the usual steps 2 to 7 of section 5.2 apply (including AUTO_CLAMPED extremes: f8 `AUTO_CLAMPED true` gives flat
  ends because 0 < 2 and 0 < 3), and CONT_ACCEL solves the wrapped system. The CONSTANT-extrapolation flattening of
  step 5 does not apply then.

f8 `AUTO true`: key (0,0) gets left (-2.34247, -0.48801) and right (1.56165, 0.32534): prev (-6, 2), slope 0.208333.

## Open points

- The exact float32 comparison at the 0.001 handle limit (10.001 typed as a float32 is moved by one ulp).
- Keys on the same frame: only the evaluation and the 0-distance-as-1 rule for auto handles were probed; their
  extrapolation slope is 0.
- AUTO_CLAMPED end keys with LINEAR extrapolation were not seen to clamp (f5, f10); a case where an end handle would
  overshoot its neighbor under LINEAR extrapolation was not constructed.
- CONT_ACCEL with ALIGNED keys, with AUTO on one side and FREE on the other, and with mixed AUTO/AUTO_CLAMPED keys was
  not probed.
- Bezier root finding: Blender's own solver (closed form or iterative, in float32) is not visible; a bisection in
  double matches to 5e-6. Near-vertical segments (handles at the 0.001 limit) may differ more.
- The Cycles modifier's other settings (frame range, influence, restrict) are not exposed by the oracle.
