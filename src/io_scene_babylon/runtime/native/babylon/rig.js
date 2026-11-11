// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// A rig description driven in a Babylon scene: the compiled program evaluates before each render (after animations),
// and every deformed mesh takes the fastest path that covers its modifier stack:
//   - shape keys and Armature modifiers only: Babylon's skinning (RigSkeleton bone texture, B-Bone joints) or the dual
//     quaternion plugin, and morph targets;
//   - other stacks on WebGPU: the compute deformer (skin, stencils, lattice, corrective smooth);
//   - anything else: the CPU stack, written into the vertex buffer.
// Objects' world matrices go to their TransformNodes (frozen for the frame), in the description's coordinates mapped
// by `axis` (Blender to scene) when given.
import { compileRig } from '../rig/program.js';
import { compileDeform } from '../deform/mesh.js';
import { RigSkin } from './skin.js';
import { RigMorphs } from './morph.js';
import { GpuDeformer, CpuDeformer, gpuSupported } from './gpu-deform.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { mul, invert } from '../math.js';

export class BabylonRig {
  // nodes: { objectName: TransformNode | Mesh } for the objects the scene shows (meshes: vertices in the
  // description's order). options: { axis, program, frameRate }.
  constructor(scene, description, nodes, { axis = null, program = null } = {}) {
    this.scene = scene;
    this.program = program ?? compileRig(description);
    this.rig = this.program.instance();
    this.axis = axis ? Float64Array.from(axis.m ?? axis) : null;
    this.axisInv = this.axis ? invert(this.axis) : null;
    this.nodes = new Map(Object.entries(nodes).map(([name, node]) => [this.program.objectIndex.get(name), node]).filter(([i]) => i !== undefined));
    this.deformers = [];
    this.rig.evaluate();
    const webgpu = scene.getEngine().isWebGPU;
    for (const [index, node] of this.nodes) {
      if (this.program.objects[index].type !== 'MESH' || !node.getVerticesData) continue;
      const deform = compileDeform(this.program, index, this.rig);
      if (!deform.steps.length && !deform.shapeKeys) continue;
      this.deformers.push({ ...this.deformerFor(index, node, deform, webgpu), mesh: node, deform });
    }
    this.frozen = new Map();
    this.observer = scene.onBeforeRenderObservable.add(() => this.update());
    // Resolves when every deformed mesh can draw: its material variant (skeleton, morph targets, dual quaternion
    // plugin) compiled up front, and the compute kernels ready. Await it before showing the meshes; until then a mesh
    // whose shader is still compiling would be skipped for a few frames.
    this.ready = Promise.all(this.deformers.flatMap((d) => [
      d.mesh.material?.forceCompilationAsync?.(d.mesh, { useInstances: false }),
      d.ready,
    ])).then(() => this);
  }

  deformerFor(index, mesh, deform, webgpu) {
    const armatureOnly = deform.steps.every((s) => s.type === 'ARMATURE');
    // On WebGPU, Preserve Volume runs in compute: the GLSL plugin is exact on WebGL 2 only (GPU readback).
    const dqOnWebGPU = webgpu && deform.steps.some((s) => s.dq);
    if (armatureOnly && !dqOnWebGPU) {
      const skin = new RigSkin(this.scene, this.rig, index, mesh, { axis: this.axis });
      if (skin.supported) {
        const morphs = deform.shapeKeys ? new RigMorphs(this.scene, this.rig, skin.deform, mesh) : null;
        return { kind: skin.binding.dq ? 'dual-quaternion plugin' : 'skeleton', update: () => { skin.update(); morphs?.update(); } };
      }
    }
    if (webgpu && gpuSupported(deform).supported && !this.axis) {
      const gpu = new GpuDeformer(this.scene.getEngine(), this.rig, deform, mesh);
      return { kind: 'webgpu compute', update: () => gpu.update(), ready: gpu.whenReady() };
    }
    const cpu = new CpuDeformer(this.rig, deform, mesh);
    return { kind: 'cpu', update: () => cpu.update() };
  }

  // Which path each mesh took (for diagnostics).
  get paths() {
    return this.deformers.map((d) => d.kind);
  }

  setFrame(frame) {
    this.rig.setFrame(frame);
  }

  update() {
    this.rig.evaluate();
    for (const [index, node] of this.nodes) {
      if (this.program.objects[index].type === 'MESH' && this.program.objects[index].modifiers?.length) continue;
      let w = this.rig.worldView[index];
      if (this.axis) w = mul(mul(this.axis, w), this.axisInv);
      const m = this.frozen.get(index) ?? new Matrix();
      m.fromArray(Array.from(w));
      this.frozen.set(index, m);
      node.freezeWorldMatrix(m);
    }
    for (const d of this.deformers) d.update();
  }

  dispose() {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    for (const node of this.nodes.values()) node.unfreezeWorldMatrix?.();
  }
}
