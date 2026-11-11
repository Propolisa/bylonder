// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The scene's collections (docs/ir.md, Collections) as a page uses them: their tree from the scene collection in the
// outliner's order, what each holds, and which objects show. A page shows what both Blender's viewport and its render
// show: an object shows when one collection path from the scene collection to it is neither excluded nor hidden
// (Exclude, Hide in Viewport, Disable in Viewports, Disable in Renders), as Blender resolves an object linked twice.

/** @typedef {import('./ir.js').IR} IR */
/** @typedef {'exclude' | 'hide_viewport' | 'hide_render' | 'layer_hide_viewport'} Flag */

/**
 * A collection in the tree: its key, its parent's (null for the scene collection) and its depth.
 * @typedef {{ key: string, parent: string | null, depth: number }} Placed
 */

/**
 * The collections from the scene collection (or `from`) down, depth first in the outliner's order.
 * @param {IR} ir
 * @param {string | null} [from]
 * @returns {Placed[]}
 */
export function collectionTree(ir, from = ir.scene.collection) {
  /** @type {Placed[]} */
  const tree = [];
  /** @param {string} key @param {string | null} parent @param {number} depth */
  const visit = (key, parent, depth) => {
    tree.push({ key, parent, depth });
    for (const child of ir.collections[key]?.children ?? []) visit(child, key, depth + 1);
  };
  if (from && ir.collections[from]) visit(from, null, 0);
  return tree;
}

/**
 * A collection's key from its key or name.
 * @param {IR} ir
 * @param {string} collection
 */
export function collectionKey(ir, collection) {
  if (ir.collections[collection]) return collection;
  const found = Object.keys(ir.collections).find((key) => ir.collections[key].name === collection);
  if (!found) throw new Error(`No collection ${collection}`);
  return found;
}

/**
 * The objects a collection holds, and with `recursive` those its child collections hold (Blender's all_objects).
 * @param {IR} ir
 * @param {string} key
 * @param {boolean} [recursive]
 * @returns {string[]}
 */
export function objectsIn(ir, key, recursive = true) {
  const collection = ir.collections[key];
  if (!collection) return [];
  return [...new Set([...collection.objects, ...(recursive ? collection.children.flatMap((child) => objectsIn(ir, child)) : [])])];
}

// What an object's data and materials are: IDs it reaches that are not objects, scenes, collections or worlds.
const SHARED = /^(OB|SC|GR|WO):/;
/**
 * The IDs a collection's objects use (their data, materials, node groups), with the objects themselves.
 * @param {IR} ir
 * @param {string} key
 */
export function idsIn(ir, key) {
  const found = new Set(objectsIn(ir, key)), queue = [...found];
  while (queue.length) {
    const from = /** @type {string} */ (queue.shift());
    for (const { from: owner, to } of ir.references) if (owner === from && !SHARED.test(to) && !found.has(to)) { found.add(to); queue.push(to); }
  }
  return found;
}

/**
 * Each object's showing through its collections, by key, from the collections' flags as `flag` gives them; an object
 * linked only to excluded collections does not show.
 * @param {IR} ir
 * @param {(key: string, flag: Flag) => boolean} flag
 */
export function showing(ir, flag) {
  /** @type {Map<string, boolean>} */
  const shown = new Map();
  /** @param {string} key @param {boolean} visible @param {Set<string>} seen */
  const visit = (key, visible, seen) => {
    for (const object of ir.collections[key].objects) shown.set(object, (shown.get(object) ?? false) || visible);
    for (const child of ir.collections[key].children) {
      if (seen.has(child) || flag(child, 'exclude')) continue;
      const hidden = flag(child, 'layer_hide_viewport') || flag(child, 'hide_viewport') || flag(child, 'hide_render');
      visit(child, visible && !hidden, new Set([...seen, child]));
    }
  };
  if (ir.scene.collection && ir.collections[ir.scene.collection]) visit(ir.scene.collection, true, new Set([ir.scene.collection]));
  for (const key of Object.keys(ir.collections)) for (const object of ir.collections[key].objects) if (!shown.has(object)) shown.set(object, false);
  return shown;
}
