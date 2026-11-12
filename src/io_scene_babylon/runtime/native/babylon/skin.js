// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// GPU skinning of a rig's mesh on Babylon's own path: a Skeleton subclass whose bone texture holds the joint matrices
// of src/deform/binding.js (deforming bones and B-Bone segment joints), and the mesh's matrices indices and weights.
// Shape keys go to a MorphTargetManager (src/babylon/morph.js), which Babylon applies before skinning.
//
// Coordinates: the mesh's vertex data is in the description's object space (Blender's). `axis` (column-major or a
// Babylon Matrix) maps those coordinates to the mesh's local Babylon coordinates when they differ; joint matrices are
// conjugated by it.
import { Skeleton } from '@babylonjs/core/Bones/skeleton.js';
import { Bone } from '@babylonjs/core/Bones/bone.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { compileDeform } from '../deform/mesh.js';
import { buildBinding, jointMatrices, dualQuatData, MAX_INFLUENCES } from '../deform/binding.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { RigDualQuatPlugin, DualQuatTexture } from './dq-plugin.js';
import { mul, invert } from '../math.js';

// Skeleton whose transform matrices are written by the rig, not computed from bones.
export class RigSkeleton extends Skeleton {
  constructor(name, scene, jointCount) {
    super(name, `${name}-rig`, scene);
    for (let i = 0; i < jointCount; i++) new Bone(`joint${i}`, this);
    this.rigMatrices = new Float32Array((jointCount + 1) * 16);
  }

  setMatrices() {
    this._markAsDirty();
  }

  _computeTransformMatrices(targetMatrix) {
    this.onBeforeComputeObservable.notifyObservers(this);
    targetMatrix.set(this.rigMatrices.subarray(0, Math.min(this.rigMatrices.length, targetMatrix.length)));
  }
}

export class RigSkin {
  // inst: RigInstance; meshIndex: the mesh object's index in the program; mesh: the Babylon Mesh whose vertices are
  // the description mesh's, in order.
  constructor(scene, inst, meshIndex, mesh, { axis = null } = {}) {
    this.inst = inst;
    this.mesh = mesh;
    this.deform = compileDeform(inst.program, meshIndex);
    this.binding = buildBinding(inst, this.deform);
    this.axis = axis ? Float64Array.from(axis.m ?? axis) : null;
    this.axisInv = this.axis ? invert(this.axis) : null;
    // The dual quaternion plugin is WebGL 2 only: on WebGPU Preserve Volume runs in compute (GpuDeformer), and the
    // plugin's first pipeline there can keep a wrong state (README, open items).
    if (this.binding.dq && scene.getEngine().isWebGPU) { this.binding.supported = false; this.binding.reasons.push('Preserve Volume on WebGPU runs in compute'); }
    if (!this.binding.supported) return;
    const { indices, weights, influences } = this.binding;
    // Per Babylon vertex: its evaluated vertex's influences (draw_vertices), or the vertex's own.
    const draw = this.deform.draw, nv = draw ? draw.length : indices.length / MAX_INFLUENCES;
    const pick = (src, from) => {
      const out = new Float32Array(nv * 4);
      for (let v = 0; v < nv; v++) {
        const s = draw ? draw[v] : v;
        for (let i = 0; i < 4; i++) out[v * 4 + i] = src[s * MAX_INFLUENCES + from + i];
      }
      return out;
    };
    if (this.binding.dq) {
      // Preserve Volume: the dual quaternion plugin deforms; Babylon's skeleton is not used.
      for (const [kind, src, from] of [['rigJoints0', indices, 0], ['rigWeights0', weights, 0], ['rigJoints1', indices, 4], ['rigWeights1', weights, 4]]) {
        mesh.setVerticesData(kind, pick(src, from), false, 4);
      }
      this.dqTexture = new DualQuatTexture(scene, this.binding.joints.length, !!this.binding.running);
      mesh.metadata = { ...mesh.metadata, rigDualQuat: { texture: this.dqTexture.texture, pre: new Matrix(), preInv: new Matrix() } };
      if (mesh.material && !mesh.material.pluginManager?.getPlugin('RigDualQuat')) new RigDualQuatPlugin(mesh.material);
      return;
    }
    mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, pick(indices, 0), false, 4);
    mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, pick(weights, 0), false, 4);
    if (influences > 4) {
      mesh.setVerticesData(VertexBuffer.MatricesIndicesExtraKind, pick(indices, 4), false, 4);
      mesh.setVerticesData(VertexBuffer.MatricesWeightsExtraKind, pick(weights, 4), false, 4);
    }
    mesh.numBoneInfluencers = influences;
    this.skeleton = new RigSkeleton(`${mesh.name}-skeleton`, scene, this.binding.joints.length);
    mesh.skeleton = this.skeleton;
  }

  get supported() {
    return this.binding.supported;
  }

  // Writes this frame's joint matrices (after inst.evaluate()).
  update() {
    if (!this.binding.supported) return;
    if (this.binding.dq) {
      const { data, pre, preInv } = dualQuatData(this.inst, this.deform, this.binding);
      this.dqTexture.update(data);
      const d = this.mesh.metadata.rigDualQuat;
      d.pre.fromArray(Array.from(this.axis ? mul(pre, this.axisInv) : pre));
      d.preInv.fromArray(Array.from(this.axis ? mul(this.axis, preInv) : preInv));
      return;
    }
    const out = this.skeleton.rigMatrices;
    jointMatrices(this.inst, this.deform, this.binding, out);
    if (this.axis) {
      const n = out.length / 16;
      for (let j = 0; j < n; j++) {
        const m = mul(mul(this.axis, out.subarray(j * 16, j * 16 + 16)), this.axisInv);
        out.set(m, j * 16);
      }
    }
    this.skeleton.setMatrices();
  }
}
