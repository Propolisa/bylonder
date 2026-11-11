// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Shape keys as Babylon morph targets (specs/shape_keys.md). The mesh's positions are the Basis key's. Relative keys
// become one target each: basis + group weight * (key - its reference key), so a key's vertex group and relative key
// are baked in and the influence is the clamped value. Absolute keys become one target per key with the influences
// the eval_time weights give (they sum to one, so basis + sum of w (key - basis) is the mix).
import { MorphTarget } from '@babylonjs/core/Morph/morphTarget.js';
import { MorphTargetManager } from '@babylonjs/core/Morph/morphTargetManager.js';
import { relativeTerms, keyValue, absoluteWeights } from '../deform/shape-keys.js';

export class RigMorphs {
  constructor(scene, inst, deform, mesh) {
    this.inst = inst;
    this.deform = deform;
    const sk = deform.shapeKeys, keys = sk.key_blocks;
    this.relative = sk.use_relative !== false;
    const groups = new Map((inst.program.objects[deform.mesh].data.vertex_groups ?? []).map((g) => [g.name, g.weights]));
    // Per Babylon vertex through draw_vertices (the evaluated vertex it draws).
    const drawn = (xyz) => (deform.draw ? Float32Array.from({ length: deform.draw.length * 3 }, (_, i) => xyz[deform.draw[(i / 3) | 0] * 3 + (i % 3)]) : xyz);
    const basis = new Float32Array(keys[0].co);
    this.manager = new MorphTargetManager(scene);
    this.targets = [];
    if (this.relative) {
      this.terms = relativeTerms(keys, groups);
      for (const t of this.terms) {
        const pos = new Float32Array(basis);
        for (let v = 0; v < pos.length / 3; v++) {
          const g = t.group ? t.group[v] ?? 0 : 1;
          for (let a = 0; a < 3; a++) pos[v * 3 + a] += g * t.delta[v * 3 + a];
        }
        this.targets.push(this.add(t.key.name, drawn(pos)));
      }
    } else {
      for (const k of keys) this.targets.push(this.add(k.name, drawn(new Float32Array(k.co))));
    }
    mesh.morphTargetManager = this.manager;
    this.update();
  }

  add(name, positions) {
    const t = new MorphTarget(name, 0);
    t.setPositions(positions);
    this.manager.addTarget(t);
    return t;
  }

  update() {
    const { inst, deform } = this;
    if (this.relative) {
      this.terms.forEach((t, i) => { this.targets[i].influence = t.key.mute ? 0 : keyValue(t.key, inst.shapeKeyValue?.(deform.mesh, t.key.name)); });
      return;
    }
    const w = absoluteWeights(deform.shapeKeys, inst.shapeKeyEvalTime?.(deform.mesh));
    this.targets.forEach((t, i) => { t.influence = i ? w[i] : 0; });
  }
}
