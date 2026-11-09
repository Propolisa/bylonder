# Clean-room driver units

Exported pages run Blender's drivers with units written without Blender's source: driver expressions, driver variables
and F-Curve evaluation, in `src/io_scene_babylon/runtime/drivers/` (docs/controllable-exports.md,
Decision 8). This folder keeps the proof of how they were made, as the process left it.

- `PROCESS.md`: the process. A specification agent learned Blender's behavior from published documentation and from
  an oracle (Blender's module compiled to WebAssembly, run as a black box), and wrote the specification. An implementer
  wrote the units from that specification and the oracle alone.
- `spec/`: the specification (`drivers.md`, `expressions.md`, `fcurves.md`), its agent's log of every file read and
  URL opened (`LOG.md`), and the audit of its transcript (`AUDIT.txt`).
- `impl/`: the implementer's results (`RESULTS.md`: fuzz rates against the oracle, the rules found beyond the
  specification, the cases still open), its log (`LOG.md`), the final fuzz runs (`final-run.txt`) and the audits of its
  transcripts: `AUDIT.txt` for the units, `AUDIT-typing.txt` for the later pass that made them pass `tsc --strict`
  (fuzz and regression results byte-identical).

The audits list every file each agent read, every URL it opened and every path its commands touched, and flag any
command that could have reached Blender's or Bylonder's source (`audit.mjs` in the clean room). The units are copied
into the runtime unchanged, but for their license line: written as MIT, they carry Bylonder's MIT OR Apache-2.0, as
the project's own code does (the owner's decision). A fix to them goes back through the implementer, with a new audit; an agent that has read
Blender's or Bylonder's Blender-derived source writes the failing case as a black-box note and does not change them.

Open notes for the implementer:

- Rotation readings (ROT_* channels, ROTATION_DIFF) differ from Blender in about 0.3% of random cases, at float32
  branch boundaries (`impl/RESULTS.md`); F-Curves with Continuous Acceleration smoothing are not robust (45%). The
  export samples each driver's F-Curve through the units against Blender's and keeps the driver baked where they differ.
