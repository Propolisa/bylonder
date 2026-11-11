# Constraint specification (clean room)

Behaviour of Blender's object and bone constraints, written without Blender's source for a clean-room Babylon.js
implementation (MIT OR Apache-2.0). Learned from Blender's manual and from a black-box oracle: the reference Blender
5.2.3 release binary driven through its Python API by the scripts here. `LOG.md` lists every file read, URL opened and
oracle run; `AUDIT.txt` is the audit of the agent's transcript (`audit.mjs` of the clean room, run with the allowlist in `LOG.md`, Audit).

## Ranking

Constraints counted in Blender's 19 demo files and one generated Rigify human rig (`oracle/counts.jsonl`):

| Rank | Type | Uses | Spec | State |
|---|---|---|---|---|
| | foundations | | `specs/00-foundations.md` | spaces, bone pose, influence: exact |
| 1 | `COPY_TRANSFORMS` | 168 | `specs/copy_transforms.md` | exact |
| 2 | `STRETCH_TO` | 144 | `specs/stretch_to.md` | exact |
| 3 | `COPY_LOCATION` | 88 | `specs/copy_location.md` | exact |
| 4 | `COPY_ROTATION` | 48 | `specs/copy_rotation.md` | exact but legacy Offset with inverted axes |
| 5 | `COPY_SCALE` | 45 | `specs/copy_scale.md` | exact |
| 6 | `DAMPED_TRACK` | 34 | `specs/damped_track.md` | exact |
| 7 | `IK` | 15 | `specs/ik.md` | two bones with a pole exact; iterative cases open |
| 8 | `LIMIT_ROTATION` | 15 | `specs/limit_rotation.md` | exact |
| 9 | `ARMATURE` | 9 | `specs/armature.md` | exact but Preserve Volume |
| 10 | `TRACK_TO` | 4 | `specs/track_to.md` | exact |
| 11 | `LIMIT_DISTANCE` | 4 | `specs/limit_distance.md` | exact |
| 12 | `CHILD_OF` | 3 | `specs/child_of.md` | exact but bone owners with axis flags |
| | `SPLINE_IK` | 0 | `specs/spline_ik.md` | placement and scale found; roll open |

No counted file uses the other types. Rigify also drives constraint influence (29), mute (8) and Armature target
weights (49).

## Running the oracle

From this folder, with `B` the reference Blender:

    python gen/copy_transforms.py
    B -b --factory-startup --python tools/oracle.py -- oracle/copy_transforms.cases.json specs/copy_transforms.fixtures.json
    python tools/check_copy_transforms.py specs/copy_transforms.fixtures.json

`gen/*.py` write case files, `tools/oracle.py` evaluates them in Blender, `tools/check_*.py` compare the spec's
formulas (own NumPy code) with the answers. The fixture format is described in `specs/copy_transforms.md`.
