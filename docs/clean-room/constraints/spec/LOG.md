# Log

Every file read, every URL opened and every oracle run, in order. Writes are only inside
`C:\Users\nifty\Downloads\bylonder-constraints-spec\`.

Note: the agent harness injected the text of the Bylonder checkout's `CLAUDE.md`, the auto-memory index and the git
status into the context before any tool call. They hold working rules and no Blender source.

## Files and URLs

1. Listed `C:\Users\nifty\Downloads\bylonder\.tools\` and its subfolders; read `.tools\agent-brief.md` (working rules,
   paths of the reference Blender); `git show --stat e7e20061` (file names only).
2. Read `scripts\demo-files.mjs` (downloads Blender's demo files; no Blender code), grep for `demo` in `vite.config.js`,
   read `src\workspace\blender-demo-files.json` (list of demo file URLs).
3. Opened with Blender only (never as text): the 19 demo files in `.tools\demo\`.
4. URLs (WebFetch, navigation only came back): `https://docs.blender.org/manual/en/latest/animation/constraints/interface/common.html`,
   `.../interface/stack.html`.
5. URLs (curl to `manual-raw\`, converted to text in `manual-text\` by `tools\html2text.py`), all under
   `https://docs.blender.org/manual/en/latest/animation/constraints/`: introduction, interface/common, interface/stack,
   interface/header, interface/index, transform/copy_transforms, copy_location, copy_rotation, copy_scale,
   limit_rotation, limit_distance, limit_location, limit_scale, maintain_volume, transformation, tracking/stretch_to,
   damped_track, ik_solver, spline_ik, track_to, locked_track, clamp_to, relationship/armature, child_of, action,
   floor, follow_path, pivot, shrinkwrap. Also `.../animation/armatures/posing/bone_constraints/inverse_kinematics/introduction.html`,
   `.../animation/armatures/bones/properties/relations.html` and `.../transform.html`.
6. Read on main through `git show`: `docs/clean-room/PROCESS.md`, `README.md`, `spec/LOG.md`, `spec/AUDIT.txt`
   (process only).

No Blender source, `*.gen.js`, `tools/blender-port/`, `src/blenkernel/` or WASM sources were opened.

## Oracle

The oracle is the reference Blender 5.2.3 release binary
(`.tools\blender\blender-5.2.3-windows-x64\blender.exe -b --factory-startup`), driven through its Python API by own
scripts in `tools\`. Blender's bundled Python and add-ons were executed, never opened.

- `tools\count.py`: counts constraints per type in an open file. Run on the 19 demo files and the Rigify rig.
- `tools\rigify.py`: enables the bundled Rigify add-on, adds the human metarig, generates the rig, saves
  `oracle\rigify_human.blend`.
- `Constraint.type` enum listed with `--python-expr`.
- `tools\spaces.py`: random armatures and objects; records `Object.convert_space` between every space, pose and rest
  matrices. Output `oracle\spaces.json`.
- `tools\oracle.py`: builds the scene of each case in a JSON file, evaluates it, records `matrix_world`, pose and rest
  bone matrices. Case files are written by `gen\*.py`; results are the `*.fixtures.json` beside each spec.
- `tools\bonemath.py`, `tools\check_spaces.py`, `tools\fit_inherit.py` and inline `python -` checks: own NumPy
  reimplementation of the spec's formulas, compared with the oracle's answers.

Fits, in order: bone spaces (World, Pose, Local with Parent, Local) against `convert_space`; inherit scale modes
(Full, Fix Shear, Aligned, Average, None, None Legacy), Inherit Rotation off, Local Location off; object Local space;
influence blending (`influence_*` cases); stack order, parenting, muted and target-less cases.

## Later files read

7. `C:\Users\nifty\cleanroom\audit.mjs` (first 40 lines, for its usage) and a listing of `C:\Users\nifty\cleanroom\`.
8. The agent's own transcript, only as the audit's input.

## Oracle runs, in order

Every run is `blender.exe -b --factory-startup --python tools\oracle.py -- <cases> <results>` unless named.

1. `tools\count.py` on the 19 demo files and `oracle\rigify_human.blend` (after `tools\rigify.py`): `oracle\counts.jsonl`.
2. `--python-expr` listing `Constraint.type` items.
3. `tools\spaces.py`: `oracle\spaces.json`. Fits: `tools\check_spaces.py`, `tools\fit_inherit.py`, inline checks,
   `tools\bonemath.py`.
4. `gen\foundations.py` (twice; the second run made bone B unconnected and added `connected_bone_keeps_head`):
   `specs\00-foundations.fixtures.json`. Check: `tools\check_foundations.py`, inline checks.
5. `tools\props.py` (twice; the first failed on vector values): `oracle\props.json`, every constraint's properties
   and defaults.
6. `tools\oracle.py` changed to also record `unconstrained` and `constraints_after`.
7. `gen\copy_transforms.py`: `specs\copy_transforms.fixtures.json`. Check: `tools\ref.py`,
   `tools\check_copy_transforms.py`.
8. `gen\stretch_to.py`, `gen\stretch_smooth.py`: `specs\stretch_to.fixtures.json`, `specs\stretch_smooth.fixtures.json`.
   Check: `tools\check_stretch_to.py`.
9. `gen\copy_lrs.py`: `specs\copy_location|copy_rotation|copy_scale.fixtures.json`. Checks: `tools\check_copy_ls.py`,
   `tools\euler.py`, `tools\check_copy_rotation.py`.
10. `gen\rot_branch.py`, `gen\rot_offset.py`: `specs\copy_rotation_branches.fixtures.json`,
    `specs\copy_rotation_offset.fixtures.json`.
11. `tools\settings_census.py` on the Rigify rig and the four demo files with constraints; a `--python-expr` listing
    of Rigify's `ADD` and `OFFSET` Copy Rotation settings.
12. `gen\damped_track.py`: `specs\damped_track.fixtures.json`. Check: `tools\check_damped_track.py`.
13. `gen\ik_two_bone.py`, `gen\ik_chain.py`: `specs\ik_two_bone.fixtures.json`, `specs\ik_chain.fixtures.json`.
    Checks: `tools\ik2.py`, `tools\check_ik2.py`, `tools\ikchain.py`, inline checks.
14. `gen\limit_rotation.py`: `specs\limit_rotation.fixtures.json`. Check: `tools\check_limit_rotation.py`.
15. `gen\armature.py`: `specs\armature.fixtures.json`. Inline checks.
16. `gen\track_to.py`: `specs\track_to.fixtures.json`. Check: `tools\check_track_to.py`.
17. `gen\limit_distance.py`: `specs\limit_distance.fixtures.json`. Check: `tools\check_limit_distance.py`.
18. `gen\child_of.py`: `specs\child_of.fixtures.json`. Check: `tools\check_child_of.py`, inline checks.
19. `gen\spline_ik.py`: `specs\spline_ik.fixtures.json`. Inline checks of joint placement and scales.

Progress was reported to the coordinator with SendMessage (no attachments).

## Audit

`AUDIT.txt` is the output of `audit/allowlist-audit.mjs`, which runs the clean room's `audit.mjs` unchanged on a copy
of the transcript in which two allowlisted paths are replaced by placeholders:

- `<WORK>` = `C:\Users\nifty\Downloads\bylonder-constraints-spec` (this agent's work folder; `<WORK>-branch` is the
  worktree the results were copied into)
- `<BLENDER>` = `C:\Users\nifty\Downloads\bylonder\.tools\blender\blender-5.2.3-windows-x64\blender.exe` (the
  reference Blender release binary, the oracle)

Without the allowlist 149 of 150 commands were flagged, because the pattern matches `bylonder` and `.tools` in those
paths. With it the flags left are these kinds, each reviewed:

- Reads in the Bylonder checkout, all in Files and URLs items 1, 2 and 6: listing `.tools`, `git show --stat e7e20061`,
  `scripts/demo-files.mjs`, grep of `vite.config.js`, `src/workspace/blender-demo-files.json`, `.tools/agent-brief.md`,
  `git ls-tree` and `git show` of `docs/clean-room` on main. None is Blender source or Blender-derived.
- Blender runs opening the demo files in `.tools/demo/` (counting and the settings census): opened by Blender only.
- `git worktree add` (twice; the first, without `cd`, did nothing), the branch commit, a junction of the main
  checkout's `node_modules` into the worktree, `node tests/licenses.test.js` and `node scripts/feature-docs.mjs` in
  the worktree, and the push.
- Listing `C:\Users\nifty\cleanroom\`, reading the head of `audit.mjs`, finding and auditing this agent's transcript
  (its path contains `C--Users-nifty-Downloads-bylonder`).
- Commands whose text mentions `bylonder` without reading anything there: writing this log section and
  `audit/allowlist-audit.mjs`.
