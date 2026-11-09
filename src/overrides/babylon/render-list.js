// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's render target lists: a list set in place and only when it changed, as Babylon's renderListPredicate rebuilds it every render and a list filled again from empty makes every material resolve its effect again each frame; goes when Babylon keeps an unchanged list.
// Returns whether it changed.
export function setRenderList(target, meshes) {
  const list = (target.renderList ??= []);
  if (list.length === meshes.length && list.every((mesh, i) => mesh === meshes[i])) return false;
  list.length = 0;
  list.push(...meshes);
  return true;
}
