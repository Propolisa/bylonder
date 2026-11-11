# Constraint foundations

Shared rules every constraint spec builds on. Observed on Blender 5.2.3 (reference binary) and checked against the
oracle to 1e-6 unless a rule says otherwise. Fixtures: `00-foundations.fixtures.json` (cases built by
`gen/foundations.py`), `../oracle/spaces.json` (space conversions, built by `tools/spaces.py`).

## Conventions

- Matrices are 4x4, column vectors, translation in the last column: `p' = M p`. Fixture matrices are row lists:
  `m[row][col]`.
- `rot(M)` is the rotation of the polar decomposition of the 3x3 part (`U V^T` of its SVD).
- `scale(M)` is the vector of column lengths of the 3x3 part.
- Euler angles in fixtures are degrees, order `XYZ` unless `rotation_mode` says otherwise; `R = Rz Ry Rx`.
- A bone's rest matrix `R` (`bone.matrix_local`) is armature space: origin at the head, Y axis along head to tail,
  roll about Y. A bone's pose matrix `P` (`pose_bone.matrix`) is armature space too. World = `ArmatureWorld @ P`.
- A bone's length is `|tail - head|` in rest; the pose tail is `P @ (0, length, 0)`.

## Where constraints run

Objects: the object's world matrix is computed first (parent world `@` parent inverse `@` own basis matrix), then the
object's constraint stack runs on that world matrix. Children of the object are parented to the result (case
`object_parent_then_constraint`).

Bones: bones are evaluated parents first. A bone's pose matrix is computed from its parent's final pose matrix (after
the parent's constraints) and its own basis (location, rotation, scale), see Bone pose below. Then the bone's
constraint stack runs on that pose matrix. Its children inherit the result (case `bone_parent_constrained`). IK and
Spline IK are the exception: see their specs.

The owner matrix every constraint receives is the result of the constraint above it (the stack runs top to bottom).
Reordering changes the result (cases `stack_order_0`, `stack_order_1`).

A constraint is skipped (has no effect, is not an error) when:

- it is disabled (`enabled = False`, case `muted`), or its influence is 0;
- a required target is missing (case `no_target`), or a bone subtarget is named but does not exist;
- its own validity rule fails (named in each spec).

Connected bones: after the whole stack, a bone with Connected on gets back the translation it had before the stack
(its head stays on the parent's tail). Rotation and scale from constraints stay (case `connected_bone_keeps_head`).
So location-only constraints have no visible effect on connected bones.

## Evaluating one constraint

1. Read each target's world matrix (see Targets).
2. Convert the owner's current world matrix into the owner space, and each target matrix into the target space.
3. Run the constraint's math on those matrices: it produces a new owner matrix in owner space.
4. Convert the new matrix back to world (or pose) space.
5. Blend with the matrix from before this constraint by influence (see Influence).

Steps 2 and 4 use the same owner space, and the conversion back uses the owner's state from before this constraint
(its parent and rest), so a constraint with nothing to change returns the owner unchanged.

## Targets

- Object target: its evaluated world matrix.
- Bone target (`subtarget` set on an armature target): `ArmatureWorld @ P` of that bone, with the translation moved
  to `head + head_tail * (tail - head)` in pose (`head_tail` in 0..1, default 0). Rotation and scale are the bone's
  (cases `head_tail_*`). `use_bbone_shape` follows the curved B-Bone; it is not covered here.
- Vertex group target (mesh or lattice): the manual says the weighted average of the group's vertex positions. A
  fixture is recorded (`vertex_group_target`); the rule is not fitted yet. No counted file uses it.

## Spaces

`owner_space` and `target_space` (default `WORLD` for both). Object owners and targets accept `WORLD`, `LOCAL`,
`CUSTOM`. Bone owners and targets also accept `POSE` and `LOCAL_WITH_PARENT`; bone targets also accept
`LOCAL_OWNER_ORIENT`. `CUSTOM` uses `space_object` (and `space_subtarget` for a bone of it).

Conversions from a world matrix `W`. Inverse conversions are the exact inverses.

| Space | Object | Bone |
|---|---|---|
| `WORLD` | `W` | `W` |
| `CUSTOM` | `C^-1 W`, `C` the custom object's (or bone's) world matrix | same |
| `POSE` | n/a | `P = ArmatureWorld^-1 W` |
| `LOCAL_WITH_PARENT` | n/a | `R^-1 P` (`R` the bone's rest matrix) |
| `LOCAL` | parented: `(ParentWorld @ ParentInverse)^-1 W`. No parent: see below | `basis_from_pose(P)`, see below |
| `LOCAL_OWNER_ORIENT` | n/a | target bone `LOCAL`, re-expressed in the owner's rest orientation, see below |

Object `LOCAL` with no parent (legacy, the manual advises against it): `L^-1 W` where `L` is the pure rotation
`rot(W0)`, no translation, `W0` the matrix of the object being converted at that moment (the owner's matrix before
this constraint, or the target's own matrix). Verified on `convert_space` and the `objspaces_*_nopar` cases.

Bone `LOCAL` for a bone without parent is `R^-1 P` (same as `LOCAL_WITH_PARENT`). With a parent it inverts the bone
pose formula below, with Connected treated as off (space conversion never drops the location). For the default bone
settings (inherit rotation, Full inherit scale, Local Location) it is `(Pp @ Rp^-1 @ R)^-1 @ P`, `Pp` and `Rp` the
parent's pose and rest.

`LOCAL_OWNER_ORIENT` (target only, meant with owner `LOCAL`): take the target bone's `LOCAL` matrix `Lt`. With
`Ct = Ro3^-1 Rt3` (3x3 rest orientations of owner `o` and target `t`), the result has 3x3 `Ct Lt3 Ct^-1` and translation
`Ct lt`. Checked with a root target bone only; with a parented target bone it is untested.

## Bone pose

Inputs: parent final pose `Pp`, parent rest `Rp`, own rest `R`, own basis `B` (`T(loc) @ Rot @ diag(scale)`), and the
flags `use_connect`, `use_inherit_rotation`, `inherit_scale` (default `FULL`), `use_local_location` (default on).
No parent: `P = R @ B`.

With a parent:

- `O = Rp^-1 R` (the rest offset; `O3` its 3x3), `t = (Pp @ O).translation` (the rest head carried by the parent).
- `P3 = Pp3` (3x3). With Inherit Rotation off, `P3 = Rp3 @ diag(scale(Pp3))` (the parent's rest orientation, keeping
  its scale).
- Orientation `Q` by `inherit_scale`:
  - `FULL`: `P3 @ O3`
  - `FIX_SHEAR`: `fix_shear(P3 @ O3)` (below)
  - `AVERAGE`: `rot(P3) * cbrt(det(P3)) @ O3`
  - `NONE`: `rot(P3) @ O3`
  - `NONE_LEGACY`: `normalize_columns(P3) @ O3`
  - `ALIGNED`: `rot(P3) @ O3`, and the parent's scale `S = scale(Pp3)` multiplies the bone's own scale per axis:
    `P3_bone = Q @ Rot @ diag(S * scale)`.
- For the other modes `P3_bone = Q @ B3`.
- Translation: `t + L @ loc`, `L = Pp3 @ O3` with Local Location on, `L = Pp3` with it off. `loc` is zero when
  Connected.

`fix_shear(M)`: keep `M`'s Y column (direction and length). Project the X and Z columns onto the plane normal to Y:
`x'`, `z'`. The new X direction is the normalized bisector of `normalize(x')` and `cross(y, normalize(z'))`; new Z is
`cross(X, y)`. Lengths: X is `k |x'|`, Z is `k |z'|`, with `k` chosen so the determinant equals `det(M)`.

## Influence

`influence` (0..1, default 1, animatable) blends the matrix before the constraint `A` with the constraint's result
`B`, both in world (or pose) space:

- translation: linear, `(1 - f) tA + f tB`;
- split each 3x3 by polar decomposition `M3 = Rot @ Stretch` (`Stretch` symmetric);
- rotation: quaternion slerp along the shorter arc;
- stretch: linear, element by element;
- result 3x3 `Rot @ Stretch`.

Checked with sheared targets (cases `influence_*`). Matrices with a negative determinant are not covered.

Constraints whose spec says so blend differently (for example by mixing their own values before building the
matrix); the default is this matrix blend.
