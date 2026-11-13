// Blender renders objects, collections and modifiers its viewports disable (Disable in Viewports, a modifier's Realtime
// off), as rigs keep their render meshes and face lattices: Main's viewport evaluation leaves them out, so the export
// shows them in the viewport while it evaluates and reads them, as a render's evaluation has them, and disables them
// again after. Subdivision and Multires keep their viewport levels, so packages keep their size.
import { sceneOf } from './controls-export.js';
import { report } from '../windowmanager/wm-reports.js';

/** @param {any} collection @returns {any[]} it and the collections under it */
const collectionTree = (collection) => [collection, ...[...collection.children].flatMap(collectionTree)];

const LEVELED = { SUBSURF: ['levels', 'render_levels'], MULTIRES: ['levels', 'render_levels'] };

/**
 * Shows in the viewport what Blender renders but the viewport disables; returns what puts them back.
 * @param {any} world
 */
export function evaluateForRender(world) {
  if (!world.mainSync) return () => {};
  const scene = sceneOf(world.mainSync);
  // With them, what a driver of Disable in Renders may switch on in the page (a rig's other look), shown but left out
  // of renders as it is, so the export reads it too.
  const switchable = (id) => [...(id.animation_data?.drivers ?? [])].some((fc) => fc.data_path === 'hide_render');
  const shown = [...collectionTree(scene.collection).slice(1), ...scene.objects].filter((id) => id.hide_viewport && (!id.hide_render || switchable(id)));
  const modifiers = [...scene.objects].flatMap((ob) => [...(ob.modifiers ?? [])].filter((m) => !m.show_viewport && m.show_render).map((m) => [ob, m]));
  for (const [ob, m] of [...scene.objects].flatMap((o) => [...(o.modifiers ?? [])].map((m) => [o, m]))) {
    const [viewport, render] = LEVELED[m.type] ?? [];
    if (viewport && m.show_render && m[viewport] !== m[render]) report('WARNING', `${ob.name}: ${m.name} exported at its viewport level ${m[viewport]}, not its render level ${m[render]}`);
  }
  if (!shown.length && !modifiers.length) return () => {};
  const view = () => world.mainSync.view();
  // An object's Disable in Viewports is its node's (rna-bylonder.js), which each view gives Main; a driver of it (a rig's
  // quality switch between proxy and render meshes) would hide it again, so it rests meanwhile.
  const nodes = new Map(world.objects.map((node) => [node.name, node]));
  const drivers = shown.flatMap((id) => [...(id.animation_data?.drivers ?? [])].filter((fc) => fc.data_path === 'hide_viewport' && !fc.mute));
  const hide = (id, value) => {
    const node = id.type && nodes.get(id.name);
    if (node) node.metadata = { ...node.metadata, wbHideViewport: value };
    id.hide_viewport = value;
  };
  for (const fc of drivers) fc.mute = true;
  for (const id of shown) hide(id, false);
  for (const [, m] of modifiers) m.show_viewport = true;
  view();
  return () => {
    for (const fc of drivers) fc.mute = false;
    for (const id of shown) hide(id, true);
    for (const [, m] of modifiers) m.show_viewport = false;
    view();
  };
}
