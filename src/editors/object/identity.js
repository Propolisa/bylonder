export const nodeId = (node) => node.metadata?.wbId || node.name;
export const deleted = (node) => !!node.metadata?.wbDeleted;
export const visible = (node) => !deleted(node) && node.isEnabled();
export function identify(node) {
  node.metadata = { ...node.metadata, wbId: nodeId(node) };
  return node;
}
