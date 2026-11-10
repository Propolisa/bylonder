// The scene's collections as the IR holds them (docs/ir.md, Collections): each collection by its ID key, with its child
// collections and objects, color tag, custom properties and flags, and its flags in each view layer; and their
// visibility flags as controls (blend-scene.js), each bound to its collection, by RNA path from bpy.data.
import { idKey } from './ir-export.js';
import { key, knob } from './controls-export.js';

const OWN = /^(bylonder|_RNA_UI$|cycles)/;
const LAYER_FLAGS = ['exclude', 'hide_viewport', 'holdout', 'indirect_only'];

// A collection's custom properties: numbers, booleans, strings and arrays of numbers.
const custom = (collection) => Object.fromEntries([...(collection.keys?.() ?? [])].filter((name) => !OWN.test(name))
  .map((name) => [name, collection.get(name)]).map(([name, value]) => [name, typeof value === 'object' && value ? [...value] : value])
  .filter(([, value]) => ['number', 'boolean', 'string'].includes(typeof value) || (Array.isArray(value) && value.every((v) => typeof v === 'number'))));

// Each LayerCollection of a view layer with its RNA path, by its collection's key.
function layerCollections(layer, base) {
  const found = new Map();
  const visit = (lc, path) => {
    found.set(idKey(lc.collection), { lc, path });
    for (const child of lc.children) visit(child, `${path}.children${key(child.name)}`);
  };
  visit(layer.layer_collection, `${base}.layer_collection`);
  return found;
}

// The view layer the page draws: the first one used for rendering.
const drawnLayer = (scene) => [...scene.view_layers].find((l) => l.use) ?? scene.view_layers[0];

// The IR's `scene` and `collections` of the scene (an RNA Scene), and the controls of their visibility in the view layer
// drawn: each collection's Disable in Viewports and Disable in Renders, and its Exclude and Hide in Viewport there.
export function exportCollections(scene) {
  const collections = {}, controls = [], layers = [...scene.view_layers].map((layer) => [layer, layerCollections(layer, `scenes${key(scene.name)}.view_layers${key(layer.name)}`)]);
  const drawn = drawnLayer(scene), root = idKey(scene.collection);
  const visit = (collection) => {
    const k = idKey(collection);
    if (collections[k]) return;
    collections[k] = { name: collection.name, children: [...collection.children].map(idKey), objects: [...collection.objects].map(idKey),
      color_tag: collection.color_tag ?? 'NONE', custom: custom(collection),
      hide_viewport: !!collection.hide_viewport, hide_render: !!collection.hide_render, hide_select: !!collection.hide_select,
      view_layers: Object.fromEntries(layers.flatMap(([layer, found]) => {
        const lc = found.get(k)?.lc;
        return lc ? [[layer.name, Object.fromEntries(LAYER_FLAGS.map((flag) => [flag, !!lc[flag]]))]] : [];
      })) };
    if (k !== root) {
      const bind = { collection: k };
      for (const flag of ['hide_viewport', 'hide_render']) controls.push(knob(`collections${key(collection.name)}.${flag}`, !!collection[flag], {}, bind));
      const at = layers.find(([layer]) => layer.name === drawn?.name)?.[1].get(k);
      if (at) for (const flag of ['exclude', 'hide_viewport']) controls.push(knob(`${at.path}.${flag}`, !!at.lc[flag], {}, bind));
    }
    for (const child of collection.children) visit(child);
  };
  visit(scene.collection);
  return { scene: { id: idKey(scene), collection: root, view_layer: drawn?.name ?? null }, collections, controls };
}
