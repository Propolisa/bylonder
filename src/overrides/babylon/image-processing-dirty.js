// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's image processing dirty marks: every render pass's defines marked, as a change of the scene's image processing marks only those of the pass current as it changes (a render's camera after a Solid view kept the Solid view's encoding); goes when Babylon marks every pass.

export function markImageProcessingDirty(scene) {
  for (const mesh of scene.meshes) for (const subMesh of mesh.subMeshes ?? []) for (const wrapper of subMesh._drawWrappers) wrapper?.defines?.markAsImageProcessingDirty?.();
}
