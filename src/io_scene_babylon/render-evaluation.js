// Blender renders objects and collections its viewports disable (Disable in Viewports), as rigs keep their render
// meshes: Main's viewport evaluation leaves them out, so the export shows them in the viewport while it evaluates and
// reads them, as a render's evaluation has them, and disables them again after.
import { sceneOf } from './controls-export.js';

/** @param {any} collection @returns {any[]} it and the collections under it */
const collectionTree = (collection) => [collection, ...[...collection.children].flatMap(collectionTree)];

/**
 * Shows in the viewport what Blender renders but the viewport disables; returns what puts them back.
 * @param {any} world
 */
export function evaluateForRender(world) {
  if (!world.mainSync) return () => {};
  const scene = sceneOf(world.mainSync);
  const shown = [...collectionTree(scene.collection).slice(1), ...scene.objects].filter((id) => id.hide_viewport && !id.hide_render);
  if (!shown.length) return () => {};
  const view = () => world.mainSync.view();
  for (const id of shown) id.hide_viewport = false;
  view();
  return () => {
    for (const id of shown) id.hide_viewport = true;
    view();
  };
}
