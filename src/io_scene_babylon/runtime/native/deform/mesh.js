// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The deform stack of a mesh (or lattice) object: shape keys, then its modifiers in order, on the CPU.
// compileDeform(program, objectIndex) once: the rest geometry (positions, faces, edges, vertex groups) flows through
// the stack, so a modifier after Mask, Mirror or Subdivision binds to the generated mesh. deformMesh(inst, deform) per
// frame gives the evaluated positions in object space (of the generated mesh: deform.geo).
import { bindModifier, runModifier, maskOf } from './armature-modifier.js';
import { bindLattice, runLattice } from './lattice.js';
import { bindCorrectiveSmooth, runCorrectiveSmooth } from './corrective-smooth.js';
import { geometryOf, bindMask, bindMirror, bindSubsurf, applyStencil } from './topology.js';
import { applyShapeKeys } from './shape-keys.js';
import { bindDisplace, runDisplace } from './displace.js';
import { bindShrinkwrap, runShrinkwrap } from './shrinkwrap.js';
import { bindSurfaceDeform, runSurfaceDeform } from './surface-deform.js';
import { mulAffine, invertAffine } from '../rig/m4.js';

const KINDS = {
  ARMATURE: { bind: bindModifier, run: runArmature },
  LATTICE: { bind: bindLattice, run: runLattice },
  CORRECTIVE_SMOOTH: { bind: bindCorrectiveSmooth, run: runCorrectiveSmooth },
  MASK: { bind: bindMask, run: runStencil, topology: true },
  MIRROR: { bind: bindMirror, run: runStencil, topology: true },
  SUBSURF: { bind: bindSubsurf, run: runStencil, topology: true },
  DISPLACE: { bind: bindDisplace, run: runDisplace },
  SHRINKWRAP: { bind: bindShrinkwrap, run: runShrinkwrap },
  SURFACE_DEFORM: { bind: bindSurfaceDeform, run: runSurfaceDeform },
};

// `inst` (optional): driven modifier settings (levels, show_viewport ...) of that instance are applied; compile again
// when they change.
export function compileDeform(program, objectIndex, inst = null) {
  const ob = program.objects[objectIndex];
  const driven = (m) => {
    if (!inst?.modifierValues) return m;
    let out = m;
    for (const [key, v] of inst.modifierValues) {
      const [o, name, prop] = key.split('/');
      if (+o !== objectIndex || name !== m.name) continue;
      out = { ...out, [prop]: typeof m[prop] === 'boolean' ? v !== 0 : v };
    }
    return out;
  };
  const base = Float64Array.from(ob.data.vertices); // flat xyz (schema.js normalize)
  let geo = geometryOf(ob, base);
  const steps = [], unsupported = [];
  for (const raw of ob.modifiers ?? []) {
    const m = driven(raw);
    if (m.show_viewport === false) continue;
    const kind = KINDS[m.type];
    if (!kind) { unsupported.push(m.type); continue; }
    const bound = kind.bind(program, ob, m, geo, objectIndex);
    if (!bound) continue;
    if (bound.unsupported) { unsupported.push(bound.unsupported); continue; }
    steps.push({ ...bound, type: m.type });
    if (kind.topology) {
      const frame = bound.mirrorObject === undefined ? null : program.restFrame(objectIndex, bound.mirrorObject);
      geo = { ...bound.geo, base: applyStencil(bound.stencil, geo.base, frame) };
    }
  }
  // `modifiers` lists the Armature steps (the GPU binding reads them); `steps` is the whole stack.
  // draw_vertices: per Babylon vertex (split at seams) the evaluated vertex it draws; absent, they are the same.
  const draw = ob.data.draw_vertices ? Int32Array.from(ob.data.draw_vertices) : null;
  return { mesh: objectIndex, base, geo, steps, modifiers: steps.filter((s) => s.type === 'ARMATURE'), unsupported, shapeKeys: ob.data.shape_keys ?? null, draw };
}

// Positions per Babylon vertex: deformed positions gathered through deform.draw (or as they are without it).
export function drawnPositions(deform, positions) {
  const d = deform.draw;
  if (!d) return positions;
  const out = new Float64Array(d.length * 3);
  for (let k = 0; k < d.length; k++) { out[k * 3] = positions[d[k] * 3]; out[k * 3 + 1] = positions[d[k] * 3 + 1]; out[k * 3 + 2] = positions[d[k] * 3 + 2]; }
  return out;
}

export function deformMesh(inst, deform) {
  let cur = deform.shapeKeys ? applyShapeKeys(inst, deform) : Float64Array.from(deform.base);
  const ctx = { prevIn: cur, armatureCount: 0 };
  for (const step of deform.steps) cur = runStep(inst, deform, step, cur, ctx);
  return cur;
}

// One step of the stack on positions `cur` (a new array back); ctx carries Multi Modifier's input between steps.
export const runStep = (inst, deform, step, cur, ctx) => KINDS[step.type].run(inst, deform.mesh, step, cur, ctx);

// The mirror frame this frame: Mirror Object space from the mesh's object space.
function runStencil(inst, mesh, step, cur, ctx) {
  let frame = null;
  if (step.mirrorObject !== undefined) {
    frame = new Float64Array(16);
    const inv = new Float64Array(16);
    invertAffine(inv, 0, inst.world, step.mirrorObject * 16);
    mulAffine(frame, 0, inv, 0, inst.world, mesh * 16);
  }
  const out = applyStencil(step.stencil, cur, frame);
  ctx.prevIn = out;
  return out;
}

// An Armature modifier mixes its result by its mask into its input, or with Multi Modifier into the previous
// modifier's result, deforming that modifier's input.
function runArmature(inst, mesh, mod, cur, ctx) {
  const multi = mod.multi && ctx.armatureCount > 0, input = multi ? ctx.prevIn : cur;
  const own = new Float64Array(cur.length);
  runModifier(inst, mesh, mod, input, own);
  const out = new Float64Array(cur.length);
  for (let v = 0; v < cur.length / 3; v++) {
    const m = maskOf(mod, v);
    for (let i = 0; i < 3; i++) {
      const j = v * 3 + i;
      out[j] = multi ? cur[j] * (1 - m) + own[j] * m : input[j] + m * (own[j] - input[j]);
    }
  }
  ctx.prevIn = input;
  ctx.armatureCount++;
  return out;
}
