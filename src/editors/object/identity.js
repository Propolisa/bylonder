export const nodeId = (node) => node.metadata?.wbId || node.name;
export const deleted = (node) => !!node.metadata?.wbDeleted;
// A mesh object with geometry: faces Babylon draws, or Mesh data, which can be loose edges only (a profile for Screw).
export const hasMesh = (node) => node.getTotalVertices?.() > 0 || !!(node.metadata?.wbCreation?.mesh || node.metadata?.wbCreation?.operator);
export const visible = (node) => !deleted(node) && node.isEnabled();
export function identify(node) {
  node.metadata = { ...node.metadata, wbId: nodeId(node) };
  return node;
}
