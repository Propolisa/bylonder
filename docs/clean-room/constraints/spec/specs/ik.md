# Inverse Kinematics (`IK`), Standard solver

Rank 7: 15 uses (Rigify 8: chain length 2, with and without a pole, Stretch on; pizza_delivery 4: chain 2, no pole;
skeleton_arm_xray 3: chain 1 and chain 2 with a pole). Manual:
https://docs.blender.org/manual/en/latest/animation/constraints/tracking/ik_solver.html and
https://docs.blender.org/manual/en/latest/animation/armatures/posing/bone_constraints/inverse_kinematics/introduction.html

Fixtures: `ik_two_bone.fixtures.json` (36 cases, `gen/ik_two_bone.py`), `ik_chain.fixtures.json` (15 cases, chains of
3, 4 and 6 bones, per-bone IK locks, stiffness and limits, `gen/ik_chain.py`). Checks: `tools/check_ik2.py`,
`tools/ik2.py` (two-bone model), `tools/ikchain.py` (a Jacobian model that does not match, kept for reference).

The Standard solver is iterative: the oracle's own chain tips miss reachable targets by up to about 2e-4 (4e-4 to 1e-3
on 6-bone chains). Compare with a tolerance of 1e-3 on matrices for the exact cases below.

## Settings (Standard solver)

| Property | Default | Notes |
|---|---|---|
| `target`, `subtarget` | none | optional: without a target the tip bone moves freely and its ancestors follow (manual) |
| `pole_target`, `pole_subtarget` | none | |
| `pole_angle` | 0 | radians, -pi..pi |
| `iterations` | 500 | 0..10000 |
| `chain_count` | 0 | 0 means up to the root |
| `use_tail` | true | false: the owner's head is the effector |
| `use_stretch` | true | only bones with `pose_bone.ik_stretch > 0` stretch |
| `use_location`, `weight` | true, 1.0 | weight 0.01..1, between chains sharing bones |
| `use_rotation`, `orient_weight` | false, 1.0 | |
| `influence` | 1.0 | |
| Per bone: `lock_ik_x/y/z`, `ik_stiffness_x/y/z`, `use_ik_limit_x/y/z`, `ik_min_*`, `ik_max_*`, `ik_stretch` | unlocked, 0, off, 0 | on the pose bones of the chain |

The iTaSC solver and its `ik_type`, `limit_mode`, `distance`, `reference_axis`, `lock_*` settings are out of scope.

## Where it runs

IK ignores its place in the stack: it runs after all other constraints of the chain's bones (manual). The chain is
the owner bone and its ancestors, `chain_count` bones in all (0: to the root). With `use_tail` off the effector is the
owner's head and the owner bone itself does not turn (`use_head` case: only its parent moved).

The solve starts from the chain's current pose (after FK and the bones' other constraints), not from the rest pose
(the `nopole_*` results change with the basis rotations; starting from rest matches worse).

## Two bones with a pole target (exact, rank-relevant)

Inputs: start pose matrices `P1` (root), `P2` (tip bone), lengths `L1`, `L2` (rest lengths), root head `H`, target
point `t` (the target's position, `head_tail` applies), pole point `p`.

1. `u = normalize(t - H)`, `d = |t - H|`. The start effector is `e0 = P2.t + P2.y * L2`.
2. Align: `A` = the shortest rotation taking `e0 - H` to `u`.
3. Pole roll: `x = rot(A @ P1.y, -pole_angle) @ (A @ P1.x)` (the root's X axis turned about its own Y by
   `-pole_angle`), projected onto the plane normal to `u` and normalized. `q` = `p - H` projected onto that plane,
   normalized. Turn `A` further about `u` by the angle from `x` to `q`. So at `pole_angle = 0` the root bone's X axis
   points at the pole.
4. Apply `A` to the whole chain about `H` (start matrices `S1`, `S2`).
5. Bend in the chain's own plane: `n = normalize(cross(u, S2.t - H))` (if zero, use `S1.x`). Clamp `d` to
   `L1 + L2`. Root direction `y1 = rot(n, a) @ u` with `cos a = (L1^2 + d^2 - L2^2) / (2 L1 d)`. Root result: the
   shortest rotation from `S1.y` to `y1` applied to `S1`. Elbow `e = H + y1 * L1`.
6. Tip bone: carried by the root's rotation, then the shortest rotation from its Y axis to `t - e` (or to
   `H + u (L1 + L2) - e` when out of reach).

Matches the 16 `pole_*` cases to 2e-4 (the oracle's own convergence). With the pole on the root-target line, Blender
degenerates (`unreachable_2_*`: zero scales); guard against it.

## Influence

Each chain bone blends its transform relative to its parent (the root: its pose matrix) between the FK start and the
IK result with the foundations' polar blend, and the chain is recomposed from the root (`influence_*`, exact). A blend
of the pose-space matrices does not match.

## Not exact yet (iterative behaviour)

- No pole: the solver's minimum-change path is not reproduced. The two-bone model above without step 3 gives
  0.003 to 0.6 errors on the `nopole_*` cases; integrating a damped pseudo-inverse Jacobian from the start pose gives
  similar errors. Both reach the target. Results differ in the twist about the root-to-target line.
- Chains longer than two bones: with a pole every joint ends in one plane (`ik_chain` planarity 0), but how the bend is
  shared between joints is solver-specific. Without a pole the chain is not planar.
- Stretch: out of reach, bones with `ik_stretch > 0` scale uniformly (all three axes) until the straight chain reaches
  the target (`unreachable_*_stretch*`). The split between bones depends on `ik_stretch` in a way not fitted
  (0.5: 1.929 and 1.851; 1.0: 1.940 and 1.865 for bones of length 1.011 and 1.110).
- Out of reach without stretch: the chain points straight at the target (exact with a pole).
- `use_rotation`: position and orientation are traded off; the tip orientation comes close to the target's but not
  equal (`rotation` case).
- Per-bone locks, stiffness and limits: fixtures only.

Suggested acceptance for the implementer where exactness is open: the effector within 1e-3 of a reachable target,
the pole plane exact, and a visual match of the `nopole_*` and `ik_chain` cases.
