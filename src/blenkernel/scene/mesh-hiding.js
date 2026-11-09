// Babylon's way to hide a mesh alone: isVisible, which leaves its children drawn, as Blender hides an object (setEnabled
// would hide them too). Each reason (its collections, H) hides it until none is left; then its own isVisible comes back.
const hiding = new WeakMap();

export function hideMesh(mesh, reason, hide) {
  const entry = hiding.get(mesh);
  if (hide && !entry) {
    hiding.set(mesh, { visible: mesh.isVisible, reasons: new Set([reason]) });
    mesh.isVisible = false;
  } else if (hide) entry.reasons.add(reason);
  else if (entry?.reasons.delete(reason) && !entry.reasons.size) {
    hiding.delete(mesh);
    mesh.isVisible = entry.visible;
  }
}
// Whether a reason hides the mesh: what else sets its isVisible (Display As) leaves it alone meanwhile.
export const meshHidden = (mesh) => hiding.has(mesh);
