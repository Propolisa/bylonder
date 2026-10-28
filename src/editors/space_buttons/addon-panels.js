// Bylonder's own Properties panels, which Blender has no RNA for: they go after Blender's panels in their tab, as an
// add-on's panels do, in Blender's panel chrome. Their rows are Bylonder's (interface/primitives.js), over its stores:
// the Scene tab's systems, project data and Local State, the Compositor, particles, the material library's surface
// settings, Bylonder's node modifiers, and panels added with registerPropertiesPanel.
import { h } from 'vue';
import { PropertyRow } from '../interface/primitives.js';
import { icon } from '../interface/layout-view.js';
import { address } from '../../blenkernel/animation/model.js';
import { bindGraph } from '../../nodes/bindings.js';
import { geometryGraph } from '../../nodes/geometry-nodes.js';
import { nodeId } from '../object/identity.js';
import { particlePanels, compositingPanel } from './node-panels.js';
import { materialPanels } from './material-panels.js';
import { createPreview } from '../../blenkernel/material/preview.js';

// The tab of a panel registered with Bylonder's earlier tab ids.
const TABS = { object: 'OBJECT', modifiers: 'MODIFIER', particles: 'PARTICLES', material: 'MATERIAL', scene: 'SCENE', render: 'RENDER', output: 'OUTPUT',
  view_layer: 'VIEW_LAYER', world: 'WORLD', collection: 'COLLECTION', physics: 'PHYSICS', data: 'DATA', constraint: 'CONSTRAINT' };
let preview = null;

// A panel in Blender's chrome around Bylonder's rows; open state as Blender's panels keep it.
function chrome(state, ui) {
  return (id, title, content, { subpanel = false, actions, defaultClosed = false } = {}) => {
    const open = ui.isOpen(id, defaultClosed);
    return h('section', { key: id, class: ['bl-panel', subpanel ? 'bl-subpanel' : 'bl-panel-root', 'bl-addon-panel', open && 'is-open'], 'data-blender': id }, [
      h('header', { class: 'bl-panel-header flex items-center', onClick: (e) => { if (!e.target.closest('input,button,select')) ui.toggle(id, e, defaultClosed); } }, [
        icon(open ? 'DOWNARROW_HLT' : 'RIGHTARROW', 'bl-disclosure'), h('span', { class: 'bl-panel-label truncate' }, title), h('div', { class: 'flex-1' }),
        actions ? h('div', { class: 'flex items-center' }, actions()) : null, subpanel ? null : icon('GRIP', 'bl-grip'),
      ]),
      open ? h('div', { class: 'bl-panel-body bl-addon-body' }, content()) : null,
    ]);
  };
}

const rowFor = (world, history) => (field) => h(PropertyRow, { key: field.id || field.label, field, animation: world.animation, commit: () => history.commit() });

// A Bylonder node modifier's inputs (Array (Nodes), Geometry Nodes), as the modifier panel's body.
export function nodeModifierRows({ world, ob, modifier, definition, history = { commit() {} } }) {
  const row = rowFor(world, history);
  if (!definition) return h('p', { class: 'bl-message bl-error' }, 'Unknown modifier ' + modifier.type);
  const field = (path) => {
    const def = definition.schema[path];
    return row({ ...def, id: modifier.id + '.' + path, get: () => modifier.values[path], set: (value) => world.modifiers.set(ob, modifier.id, path, value, { finish: false }),
      refs: () => (def.animatable === false ? [] : [address('modifier:' + nodeId(ob) + ':' + modifier.id, path)]),
      choices: () => world.objects.filter((n) => n !== ob && (def.reference !== 'curve' || n.metadata?.wbCurve)).map((n) => [nodeId(n), n.name]) });
  };
  if (modifier.type === 'NODES') {
    const rows = bindGraph(world.animation, { id: 'modifier:' + nodeId(ob) + ':' + modifier.id + ':graph', title: ob.name + ' › ' + modifier.name, graph: () => geometryGraph(modifier),
      kind: 'geometry', onChange: () => { modifier.revision = (modifier.revision || 0) + 1; world.modifiers.refresh(); } }).map((f) => row({ ...f, default: undefined }));
    return h('div', { class: 'bl-addon-body flex flex-col' }, [...(rows.length ? rows : [h('p', { class: 'bl-message' }, 'Add Input blocks to the node group to expose values here.')]),
      h('button', { type: 'button', class: 'bl-widget bl-tool flex h-unit items-center justify-center gap-1 rounded-md text-xs', onClick: () => world.openNodeEditor?.('geometry') }, [icon('GEOMETRY_NODES'), 'Edit in Geometry Node Editor'])]);
  }
  return h('div', { class: 'bl-addon-body flex flex-col' }, Object.keys(definition.schema).filter((path) => !definition.schema[path].hidden).map(field));
}

export function addonPanels({ world, editor, history, systems, properties, storage, files, tab, node, state, registered, ui }) {
  const panel = chrome(state, ui), row = rowFor(world, history), commit = () => history.commit();
  const out = [];
  if (tab === 'SCENE') {
    if (world.compositor) out.push(compositingPanel({ world, row, panel }));
    out.push(...systems.map((system) => panel('store.' + system.id, system.title, () => Object.entries(system.store.schema).map(([path, def]) => row({ ...def, id: 'store.' + system.id + '.' + path,
      label: def.label || path, get: () => system.store.values[path], set: (value) => system.store.set(path, value), refs: () => (def.animatable === false ? [] : [address('store:' + system.id, path)]) })))));
    out.push(...properties.map((definition) => panel('data.' + definition.id, definition.title, () => Object.entries(definition.schema).map(([path, def]) => {
      const parts = path.split('.'), owner = () => parts.slice(0, -1).reduce((o, k) => o[k], definition.target), key = parts.at(-1);
      return row({ ...def, id: definition.id + '.' + path, label: def.label || path, get: () => owner()[key], set: (value) => { owner()[key] = value; }, refs: () => (def.animatable === false ? [] : [address(definition.id, path)]) });
    }))));
    out.push(panel('local', 'Local State', () => [row({ label: 'Remember Scene Edits', default: false, get: () => storage.enabled, set: (value) => storage.set(value) }),
      h('button', { type: 'button', class: 'bl-widget bl-tool flex h-unit items-center justify-center rounded-md text-xs', onClick: () => storage.clear() }, 'Forget Saved Scene Edits')], { defaultClosed: true }));
  }
  if (tab === 'PARTICLES' && world.particles) out.push(...particlePanels({ world, node, row, panel }).filter(Boolean));
  if (tab === 'MATERIAL' && world.materials && node?.getTotalVertices) {
    preview ??= createPreview();
    out.push(...materialPanels({ world, editor, node, row, panel, state, preview }).slice(2).filter(Boolean));
  }
  out.push(...[...registered.values()].filter((p) => TABS[p.context] === tab || p.context === tab).filter((p) => !p.poll || p.poll({ world, node }))
    .map((p) => panel(p.id, p.title, () => p.render({ world, node, row, panel, commit }))));
  return out;
}
