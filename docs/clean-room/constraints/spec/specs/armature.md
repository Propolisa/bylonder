# Armature (`ARMATURE`)

Rank 9: 9 uses, all in the Rigify rig (bones, no envelopes, no Preserve Volume; target weights are driven, 49
drivers). Manual: https://docs.blender.org/manual/en/latest/animation/constraints/relationship/armature.html

Moves the owner as the weighted sum of its target bones' deformations, as the Armature modifier does for vertices.
Fixtures: `armature.fixtures.json` (16 cases, `gen/armature.py`: objects and bones, parented and not, 1 to 3
targets, weights summing to 1 or not, influence, one Preserve Volume case). All match below to 1e-5 except
Preserve Volume.

## Settings

| Property | Default | Notes |
|---|---|---|
| `targets` | empty | each: `target` (armature object), `subtarget` (bone name), `weight` (0..1, default 0) |
| `use_deform_preserve_volume` | false | dual quaternion blending (open) |
| `use_bone_envelopes` | false | out of scope |
| `use_current_location` | false | affects envelopes and B-Bone segments only |
| `influence` | 1.0 | |

No owner or target space: the constraint works in world space.

## Math

For each target bone `i` with armature world matrix `Ai`, pose `Pi`, rest `Ri`:
`Di = Ai @ Pi @ Ri^-1 @ Ai^-1` (the bone's deformation, world space).

`W = sum(weight_i)`; `D = sum(weight_i * Di) / W` (the weights are always normalized; the matrices are summed entry
by entry, as linear blend skinning does).

Result: `D @ O`, with `O` the owner's world matrix before this constraint (for a bone, its pose matrix after its
parent, in world space; for a parented object, after parenting). Then the foundations' influence blend.

## Edge cases

- `W = 0` or no valid target: no change (assumed; not probed).
- A target bone with B-Bone segments: the modifier would use the segment's deformation; not probed.
- Preserve Volume (`preserve_volume` case) does not match the linear sum; it is expected to be dual quaternion
  blending. Open, no counted file uses it.
- Rigify drives the weights: the drivers run before the constraint, through the clean-room driver units.
