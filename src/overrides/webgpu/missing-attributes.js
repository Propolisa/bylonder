// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's stand-in for a vertex attribute a mesh lacks: a buffer of (0, 0, 0, 1) per vertex, as Blender's draw leaves an unbound attribute, where Babylon binds WebGPU one 4 byte buffer stepped per vertex, which WebGPU rejects for any draw of more vertices (the frame's whole command buffer with it); goes when Babylon binds a stand-in of the draw's size.
import { Buffer, VertexBuffer } from '@babylonjs/core';

const UNBOUND = [0, 0, 0, 1];
// What Babylon binds itself at the draw, when the mesh has instances or bones.
const INSTANCED = /^(world\d|instanceColor)$/, BONES = /^matrices(Indices|Weights)(Extra)?$/;
const boundAtDraw = (/** @type {import('@babylonjs/core').Mesh} */ mesh, /** @type {string} */ kind) => kind === VertexBuffer.PositionKind
  || (INSTANCED.test(kind) && (mesh.hasInstances || mesh.hasThinInstances)) || (BONES.test(kind) && !!mesh.skeleton);

/**
 * Fills each of `kinds` the mesh lacks, or holds for another vertex count, with an unbound attribute's value: all of
 * them, and those filled before, views of one buffer, so they take one of WebGPU's 8 vertex buffer slots.
 * @param {import('@babylonjs/core').Mesh} mesh
 * @param {string[]} kinds vertex buffer kinds
 */
export function fillMissingAttributes(mesh, kinds) {
  const count = mesh.getTotalVertices(), unbound = (/** @type {any} */ buffer) => !!buffer?.unbound;
  const missing = kinds.filter((kind) => {
    const buffer = /** @type {any} */ (mesh.getVertexBuffer(kind));
    return !buffer || (unbound(buffer) && buffer.getData().length !== count * 4);
  });
  if (!missing.length) return;
  const filled = new Set([...(mesh.getVerticesDataKinds() ?? []).filter((kind) => unbound(mesh.getVertexBuffer(kind))), ...missing]);
  const data = new Buffer(mesh.getEngine(), Float32Array.from({ length: count * 4 }, (_, i) => UNBOUND[i % 4]), false, 4);
  for (const kind of filled) mesh.setVerticesBuffer(Object.assign(data.createVertexBuffer(kind, 0, 4), { unbound: true }));
}

/**
 * Fills, once each of its effects compiles, what the mesh's material reads that the mesh lacks (a mesh whose draw
 * buffers are not Blender's: curves).
 * @param {import('@babylonjs/core').Mesh} mesh
 */
export function fillWhatItReads(mesh) {
  const fill = (/** @type {import('@babylonjs/core').Effect} */ effect) => effect.executeWhenCompiled(() => {
    const context = /** @type {any} */ (effect)._pipelineContext?.shaderProcessingContext;
    const kinds = context ? context.attributeNamesFromEffect.filter((/** @type {string} */ kind, /** @type {number} */ i) => context.attributeLocationsFromEffect[i] >= 0)
      : effect.getAttributesNames();
    fillMissingAttributes(mesh, kinds.filter((/** @type {string} */ kind) => !boundAtDraw(mesh, kind)));
  });
  const watched = new WeakSet();
  mesh.onMaterialChangedObservable.add(() => {
    const material = mesh.material;
    if (!material || watched.has(material)) return;
    watched.add(material);
    material.onEffectCreatedObservable.add(({ effect, subMesh }) => { if (subMesh?.getMesh() === mesh) fill(effect); });
  });
}
