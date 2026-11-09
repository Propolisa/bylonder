import { Light } from '@babylonjs/core';
import { hideMesh } from '../../blenkernel/scene/mesh-hiding.js';

export const nodeId = (node) => node.metadata?.wbId || node.name;
export const deleted = (node) => !!node.metadata?.wbDeleted;
// A mesh object with geometry: faces Babylon draws, or Mesh data, which can be loose edges only (a profile for Screw).
export const hasMesh = (node) => node.getTotalVertices?.() > 0 || !!(node.metadata?.wbCreation?.mesh || node.metadata?.wbCreation?.operator);
// Hidden in the viewport (Object.hide_get), as Blender hides an object: alone, never its children, which Babylon's
// setEnabled would hide too. The object stays enabled, marked hidden; a mesh stops drawing (mesh-hiding.js) and an
// overlay (an armature's bones, an empty, a camera) asks visible(). A light stops lighting through setEnabled.
export const hidden = (node) => !!node.metadata?.wbHidden || (node instanceof Light && !node.isEnabled(false));
export function setHidden(node, hide) {
  // Babylon has no other way to switch a light off alone, so a hidden light's child objects hide with it, unlike Blender.
  if (node instanceof Light) return node.setEnabled(!hide);
  node.metadata = { ...node.metadata, wbHidden: hide };
  if ('isVisible' in node) hideMesh(node, 'hide', hide);
}
export const visible = (node) => !deleted(node) && node.isEnabled() && !node.metadata?.wbHidden;
export function identify(node) {
  node.metadata = { ...node.metadata, wbId: nodeId(node) };
  return node;
}
