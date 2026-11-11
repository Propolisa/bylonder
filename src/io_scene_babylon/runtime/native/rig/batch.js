// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Many characters with the same rig: one program, one pass. evaluate() walks the op list once and runs each op for
// every instance whose inputs changed (op-major), so each op's code and the program's static data stay hot.
export class RigBatch {
  constructor(program, count) {
    this.program = program;
    this.instances = Array.from({ length: count }, () => program.instance());
  }

  setFrame(frame) {
    for (const inst of this.instances) inst.setFrame(frame);
  }

  evaluate() {
    const { ops } = this.program, list = this.instances;
    for (const inst of list) inst.pass = (inst.pass ?? 0) + 1; // per-pass caches (driver channels)
    let count = 0;
    for (let i = 0; i < ops.length; i++) {
      const deps = ops[i].deps;
      for (let n = 0; n < list.length; n++) {
        const inst = list[n];
        let need = inst.dirty[i];
        if (!need) for (let k = 0; k < deps.length; k++) if (inst.changed[deps[k]]) { need = 1; break; }
        inst.changed[i] = 0;
        if (need) { inst.changed[i] = inst.runs[i]() === false ? 0 : 1; inst.dirty[i] = 0; count++; }
      }
    }
    return count;
  }
}
