import { h } from 'vue';
import { icon, iconButton } from '../properties/icons.js';
import { openMenu } from '../ui/menu.js';
import { nodeId } from '../objects/identity.js';

const tree = (cols, run, exclude = []) => {
  const items = [{ label: 'Scene Collection', icon: 'outliner_collection', run: () => run(cols.MASTER), enabled: () => !exclude.includes(cols.MASTER) }];
  const walk = (id, depth, seen) => { for (const child of cols.byId(id).children) if (cols.byId(child) && !seen.has(child)) { items.push({ label: ' '.repeat(depth) + cols.byId(child).name, icon: 'outliner_collection', enabled: () => !exclude.includes(child), run: () => run(child) }); walk(child, depth + 1, new Set([...seen, child])); } };
  walk(cols.MASTER, 1, new Set());
  return items;
};

// Properties > View Layer. Blender keeps the view layer selector in the top bar; here it heads the tab.
export function viewLayerPanels({ world, panel }) {
  const cols = world.collections, current = cols.layer();
  return [
    h('div', { class: 'bl-id-row' }, [
      h('button', { type: 'button', class: 'bl-id-browse', title: 'Browse View Layer', onClick: e => openMenu([{ heading: 'View Layer' }, ...cols.viewLayers().map(l => ({ label: l.name, icon: 'renderlayers', checked: l === current ? () => true : undefined, run: () => cols.setViewLayer(l.id) }))], e.currentTarget) }, [icon('RENDERLAYERS')]),
      h('input', { class: 'bl-id-name', value: current.name, 'aria-label': 'View layer name', onChange: e => cols.renameViewLayer(current.id, e.target.value) }),
      iconButton('ADD', 'Add View Layer', () => cols.createViewLayer()),
      iconButton('X', 'Remove View Layer', () => cols.removeViewLayer(current.id), { disabled: cols.viewLayers().length < 2 }),
    ]),
    panel('viewlayer.info', 'View Layer', () => [h('p', { class: 'bl-message' }, 'Each view layer keeps its own Exclude and Hide in Viewport state per collection. Set them in the Outliner. Render passes are not available.')]),
  ];
}

// Properties > Collection, for the active collection.
export function collectionPanels({ world, row, panel }) {
  const cols = world.collections, id = cols.active, c = cols.byId(id);
  if (id === cols.MASTER) return [h('p', { class: 'bl-message' }, 'The Scene Collection has no properties. Click a collection in the Outliner to make it active.')];
  return [
    h('div', { class: 'bl-id-row' }, [
      h('span', { class: 'bl-id-browse' }, [icon('OUTLINER_COLLECTION')]),
      h('input', { class: 'bl-id-name', value: c.name, 'aria-label': 'Collection name', onChange: e => cols.rename(id, e.target.value) }),
    ]),
    panel('collection.restrictions', 'Restrictions', () => [
      row({ id: 'collection.selectable', label: 'Selectable', default: true, get: () => !cols.byId(id).hideSelect, set: v => cols.set(id, { hideSelect: !v }) }),
      row({ id: 'collection.hideViewport', label: 'Disable in Viewports', default: false, get: () => !!cols.byId(id).hideViewport, set: v => cols.set(id, { hideViewport: v }) }),
    ]),
  ];
}

// Properties > Object > Collections: the collections this object is linked to.
export function objectCollectionsPanel({ world, node, panel }) {
  const cols = world.collections, objectId = nodeId(node), linked = cols.memberships(objectId);
  return panel('object.collections', 'Collections', () => [
    h('button', { type: 'button', class: 'bl-wide-button', onClick: e => openMenu([{ heading: 'Add to Collection' }, ...tree(cols, id => cols.link([objectId], id), linked)], e.currentTarget) }, [icon('ADD'), 'Add to Collection']),
    ...(linked.length ? linked : [cols.MASTER]).map(id => h('div', { class: 'bl-id-row' }, [
      h('span', { class: 'bl-id-browse' }, [icon('OUTLINER_COLLECTION')]),
      h('span', { class: 'bl-id-name bl-id-static' }, id === cols.MASTER ? 'Scene Collection' : cols.byId(id).name),
      iconButton('X', 'Remove from Collection', () => cols.unlink([objectId], id), { disabled: !linked.includes(id) }),
    ])),
  ], { defaultClosed: true });
}
