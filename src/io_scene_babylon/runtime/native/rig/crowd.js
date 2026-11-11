// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// A crowd of characters on one rig with level of detail: each character has an update rate (every frame, every
// second, every fourth ... interleaved by its index) and can be FK only (no IK or Spline IK, drivers keep their last
// values). Characters whose pose inputs are identical this frame share one evaluation (the pose is copied).
export class Crowd {
  constructor(program) {
    this.program = program;
    this.members = [];
    this.frame = 0;
  }

  // { rate: 1 | 2 | 4 ..., fkOnly } per character; returns its RigInstance (set its inputs, then call update()).
  add({ rate = 1, fkOnly = false } = {}) {
    const inst = this.program.instance();
    inst.fkOnly = fkOnly;
    this.members.push({ inst, rate, phase: this.members.length });
    return inst;
  }

  setLevel(inst, { rate, fkOnly }) {
    const m = this.members.find((x) => x.inst === inst);
    if (rate) m.rate = rate;
    if (fkOnly !== undefined && fkOnly !== inst.fkOnly) { inst.fkOnly = fkOnly; inst.touchAll(); }
  }

  // Evaluates the characters due this frame. Returns how many were evaluated and how many shared another's result.
  update(frame = this.frame + 1) {
    this.frame = frame;
    const seen = new Map();
    let evaluated = 0, shared = 0;
    for (const m of this.members) {
      if ((frame + m.phase) % m.rate) continue;
      m.inst.setFrame(frame);
      const key = `${m.inst.fkOnly ? 1 : 0}:${hashInputs(m.inst)}`, twin = seen.get(key);
      if (twin && sameInputs(twin, m.inst)) { m.inst.pose.set(twin.pose); m.inst.world.set(twin.world); shared++; continue; }
      seen.set(key, m.inst);
      m.inst.evaluate();
      evaluated++;
    }
    return { evaluated, shared };
  }
}

// FNV-1a over the pose inputs' bytes (location, rotation, scale, object transforms).
function hashInputs(inst) {
  let h = 0x811c9dc5;
  for (const a of [inst.location, inst.rotation, inst.scale, inst.objLocation, inst.objRotation, inst.objScale]) {
    const u = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193);
  }
  return h >>> 0;
}

function sameInputs(a, b) {
  for (const k of ['location', 'rotation', 'scale', 'objLocation', 'objRotation', 'objScale']) {
    const x = a[k], y = b[k];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return a.properties.size === b.properties.size && [...a.properties].every(([k, v]) => b.properties.get(k) === v);
}
