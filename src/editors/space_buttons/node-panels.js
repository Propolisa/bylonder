import { h } from 'vue';
import { icon, iconButton } from '../interface/icons.js';
import { bindGraph } from '../../nodes/bindings.js';

const inputRows = (rows, row, empty) => (rows.length ? rows.map(f => row({ ...f, default: undefined })) : [h('p', { class: 'bl-message' }, empty)]);
const openButton = (label, iconName, run) => h('button', { type: 'button', class: 'bl-wide-button', onClick: run }, [icon(iconName), label]);

export function particlePanels({ world, node, row, panel }) {
  const particles = world.particles;
  if (!node?.getTotalVertices) return [h('p', { class: 'bl-message' }, 'Select a mesh object to add particle systems.')];
  const list = particles.systems(node), active = particles.active(node), index = list.indexOf(active);
  const rows = active && particles.graph(active.id)
    ? bindGraph(world.animation, { id: 'particles:' + active.id, title: node.name + ' › ' + active.name, graph: () => particles.graph(active.id), kind: 'particles' })
    : [];
  return [
    h('div', { class: 'bl-list-wrap' }, [
      h('div', { class: 'bl-list', role: 'listbox', 'aria-label': 'Particle systems' }, list.length
        ? list.map((s, i) => h('button', { class: ['bl-list-row', { active: i === index }], role: 'option', 'aria-selected': i === index, onClick: () => particles.setActive(node, i) }, [icon('PARTICLES'), h('span', s.name), h('span', { class: 'bl-list-flag', title: s.enabled ? 'Shown in viewport' : 'Hidden' }, icon(s.enabled ? 'RESTRICT_VIEW_OFF' : 'RESTRICT_VIEW_ON'))]))
        : [h('div', { class: 'bl-list-empty' })]),
      h('div', { class: 'bl-list-side' }, [
        iconButton('ADD', 'Add Particle System', () => particles.add(node)),
        iconButton('REMOVE', 'Remove Particle System', () => active && particles.remove(node, active.id), { disabled: !active }),
      ]),
    ]),
    active ? h('div', { class: 'bl-id-row' }, [
      h('span', { class: 'bl-id-browse' }, [icon('PARTICLE_DATA')]),
      h('input', { class: 'bl-id-name', value: active.name, 'aria-label': 'Particle system name', onChange: e => e.target.value.trim() && particles.update(node, active.id, { name: e.target.value.trim() }) }),
      iconButton(active.enabled ? 'RESTRICT_VIEW_OFF' : 'RESTRICT_VIEW_ON', 'Show in viewport', () => particles.update(node, active.id, { enabled: !active.enabled }), { 'aria-pressed': active.enabled }),
    ]) : null,
    active ? panel('particles.inputs', 'Inputs', () => [
      ...inputRows(rows, row, 'Add Input blocks to the particle node set to expose values here.'),
      openButton('Edit in Particle Node Editor', 'PARTICLES', () => world.openNodeEditor?.('particles')),
    ]) : null,
  ];
}

export function compositingPanel({ world, row, panel }) {
  const c = world.compositor;
  return panel('scene.compositing', 'Compositing', () => [
    row({ id: 'compositor.enabled', label: 'Use Nodes', default: false, get: () => c.enabled, set: v => c.setEnabled(v) }),
    ...(c.enabled ? inputRows(c.fields(), row, 'Post-process blocks expose their settings here.') : []),
    openButton('Open Compositor', 'NODE_COMPOSITING', () => world.openNodeEditor?.('compositor')),
    c.enabled ? h('p', { class: 'bl-message' }, 'Shown in the viewport in Rendered shading and camera view.') : null,
  ], { defaultClosed: !c.enabled });
}
