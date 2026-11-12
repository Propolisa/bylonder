// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// A mesh object's evaluated positions (its own deform stack, in its object space), once per instance and evaluate():
// the surface Surface Deform follows.
import { compileDeform } from './mesh.js';
import { CpuStack } from './cpu.js';

export function evaluatedPositions(inst, index) {
  const cache = (inst.evaluatedMeshes ??= new Map());
  let e = cache.get(index);
  if (!e) {
    const ob = inst.program.objects[index];
    const deform = ob.modifiers?.length || ob.data.shape_keys ? compileDeform(inst.program, index, inst) : null;
    e = { stack: deform ? new CpuStack(inst, deform, { normals: false }) : null, rest: Float64Array.from(ob.data.vertices), pass: -1 };
    cache.set(index, e);
  }
  if (!e.stack) return e.rest;
  if (e.pass !== inst.pass) { e.stack.run(); e.pass = inst.pass; }
  return e.stack.welded;
}
