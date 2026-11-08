// A render target's meshes set in place, and only when they changed: Babylon's renderListPredicate rebuilds the list at
// every render, and a list filled again from empty marks every mesh's lights dirty (ObjectRenderer
// _renderListHasChanged), so every material resolved its effect again each frame. Returns whether they changed.
export function setRenderList(target, meshes) {
  const list = (target.renderList ??= []);
  if (list.length === meshes.length && list.every((mesh, i) => mesh === meshes[i])) return false;
  list.length = 0;
  list.push(...meshes);
  return true;
}
