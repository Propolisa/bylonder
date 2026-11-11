# Copy Transforms (`COPY_TRANSFORMS`)

Rank 1: 168 uses, all in the Rigify rig (bones copying bones, mostly `LOCAL` or `POSE` space, `REPLACE`).
Manual: https://docs.blender.org/manual/en/latest/animation/constraints/transform/copy_transforms.html

Makes the owner match the target's location, rotation and scale, or combines the two matrices. Fixtures:
`copy_transforms.fixtures.json` (56 cases, `gen/copy_transforms.py`); all match the formulas below to 3e-6
(`tools/check_copy_transforms.py`). Read `00-foundations.md` first.

## Settings

| Property | Default | Values |
|---|---|---|
| `target`, `subtarget` | none | object; bone or vertex group |
| `head_tail` | 0.0 | 0..1, bone targets |
| `use_bbone_shape` | false | |
| `remove_target_shear` | false | |
| `mix_mode` | `REPLACE` | `REPLACE`, `BEFORE_FULL`, `BEFORE`, `BEFORE_SPLIT`, `AFTER_FULL`, `AFTER`, `AFTER_SPLIT` |
| `owner_space`, `target_space` | `WORLD` | foundations |
| `influence` | 1.0 | 0..1 |

Needs a target; without one it does nothing.

## Math

`O` is the owner matrix in owner space, `T` the target matrix in target space.

If `remove_target_shear`: replace the 3x3 of `T` with `fix_shear(T3)` (foundations, Bone pose), translation kept.

Split a matrix `M` into `t` (translation), `s` (column lengths of the 3x3) and `R` (the 3x3 with each column divided
by its length; not re-orthogonalized, so a sheared input keeps its shear in `R`). If `det(R) < 0`, negate `s.x` and
the X column of `R`. `compose(t, R, s)` builds `R @ diag(s)` with translation `t`.

| `mix_mode` | Result |
|---|---|
| `REPLACE` | `T` |
| `BEFORE_FULL` | `T @ O` (owner as a child of the target) |
| `AFTER_FULL` | `O @ T` (target as a child of the owner) |
| `BEFORE` (Aligned) | `compose(T @ tO, RT @ RO, sT * sO)` |
| `AFTER` (Aligned) | `compose(O @ tT, RO @ RT, sO * sT)` |
| `BEFORE_SPLIT` | `compose(tT + tO, RT @ RO, sT * sO)` |
| `AFTER_SPLIT` | `compose(tO + tT, RO @ RT, sO * sT)` |

`T @ tO` means the point `tO` transformed by `T`. `sT * sO` is per axis.

Then convert back from owner space and blend by influence with the foundations' polar blend.

## Edge cases

- `LOCAL` owner and target spaces between two bones copy the target bone's local (basis-like) transform onto the
  owner's own rest frame: this is the Rigify pattern (`bone_*_LOCAL` cases).
- Connected owner bones keep their head (foundations).
- A sheared target (child of a non-uniformly scaled parent) is copied with its shear unless `remove_target_shear`.

## Fixture format (all specs)

Each fixture is `{name, input, output, unconstrained, constraints_after}`:

- `input`: the scene as built by `tools/oracle.py`: `objects` (name, kind, `loc`, `rot` in degrees `XYZ`, `scale`,
  `parent`, armature `bones` with `head`, `tail`, `roll` in degrees, bone flags, `pose` per bone) and `constraints`
  (`owner`, `bone` for bone owners, the type and its properties; a value `"@Name"` is a reference to object `Name`).
- `output`: per object `matrix_world`, and per bone `pose` (armature space) and `rest` (`bone.matrix_local`).
- `unconstrained`: the same scene with every constraint disabled.
- `constraints_after`: the float properties of each constraint after evaluation (values Blender writes back).
