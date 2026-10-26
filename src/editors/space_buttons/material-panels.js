import { h } from 'vue';
import { icon, iconButton } from '../interface/icons.js';
import { openMenu } from '../interface/menu.js';
import { address } from '../../blenkernel/animation/model.js';
import { bindGraph } from '../../nodes/bindings.js';
import { materialId } from '../../blenkernel/material/library.js';
import { resolve } from '../../blenkernel/material/schema.js';

export function materialPanels({ world, editor, node, row, panel, state, preview }) {
  const library = world.materials;
  if (!node?.getTotalVertices) return [h('p', { class: 'bl-message' }, 'Select a mesh object to edit its materials.')];
  const slots = library.slots(node), index = library.active(node), material = slots[index] || null;
  const type = library.type(material);
  const browse = e => openMenu(() => [
    { heading: 'Browse Material to be linked' },
    ...library.all().map(m => ({ label: m.name + (library.users(m) ? '' : '  (0)'), icon: 'material', checked: m === material ? () => true : undefined, run: () => library.assign(node, index, m) })),
    '-',
    { label: 'New Material', icon: 'add', items: Object.entries(library.types).map(([id, t]) => ({ label: t.title, run: () => library.assign(node, index, library.create(id)) })) },
  ], e.currentTarget);
  const specials = e => openMenu([
    { label: 'Copy Material to Selected', enabled: () => !!material, run: () => { for (const other of editor.selection.nodes) if (other !== node && other.getTotalVertices) library.assign(other, Math.min(library.active(other), Math.max(0, library.slots(other).length - 1)), material); } },
    { label: 'Remove Unused Slots', run: () => library.removeUnusedSlots(node) },
    '-',
    { label: 'Purge Unused Materials', run: () => world.notify(library.purge() + ' unused materials removed') },
  ], e.currentTarget);

  const list = h('div', { class: 'bl-list-wrap' }, [
    h('div', { class: 'bl-list', role: 'listbox', 'aria-label': 'Material slots' }, slots.length
      ? slots.map((m, i) => h('button', { class: ['bl-list-row', { active: i === index }], role: 'option', 'aria-selected': i === index, onClick: () => library.setActive(node, i) }, [icon('MATERIAL', { class: 'bl-icon shading' }), h('span', m?.name || '')]))
      : [h('div', { class: 'bl-list-empty' })]),
    h('div', { class: 'bl-list-side' }, [
      iconButton('ADD', 'Add Material Slot', () => library.addSlot(node)),
      iconButton('REMOVE', 'Remove Material Slot', () => library.removeSlot(node), { disabled: !slots.length }),
      h('button', { type: 'button', class: 'bl-icon-button bl-specials', title: 'Material Specials', onClick: specials }, icon('DOWNARROW_HLT')),
      iconButton('TRIA_UP', 'Move Slot Up', () => library.moveSlot(node, index, -1), { disabled: index < 1 }),
      iconButton('TRIA_DOWN', 'Move Slot Down', () => library.moveSlot(node, index, 1), { disabled: index >= slots.length - 1 }),
    ]),
  ]);

  const users = material ? library.users(material) : 0;
  const datablock = h('div', { class: 'bl-id-row' }, material ? [
    h('button', { type: 'button', class: 'bl-id-browse', title: 'Browse Material to be linked', onClick: browse }, [icon('MATERIAL', { class: 'bl-icon shading' })]),
    h('input', { class: 'bl-id-name', value: material.name, 'aria-label': 'Material name', onChange: e => library.rename(material, e.target.value) }),
    users > 1 ? h('button', { type: 'button', class: 'bl-id-users', title: `${users} users · Click to make single-user`, onClick: () => library.makeSingleUser(node, index) }, String(users)) : null,
    iconButton(material.metadata?.wbFakeUser ? 'FAKE_USER_ON' : 'FAKE_USER_OFF', 'Fake User · Keep this material even when unused', () => library.toggleFakeUser(material), { 'aria-pressed': !!material.metadata?.wbFakeUser }),
    iconButton('DUPLICATE', 'New Material · Duplicate this material', () => library.newMaterial(node, index)),
    iconButton('X', 'Unlink Material', () => library.unlink(node, index)),
  ] : [
    h('button', { type: 'button', class: 'bl-id-browse', title: 'Browse Material to be linked', onClick: browse }, [icon('MATERIAL', { class: 'bl-icon shading' })]),
    h('button', { type: 'button', class: 'bl-id-new', onClick: () => library.newMaterial(node, index) }, [icon('ADD'), 'New']),
  ]);

  if (!material) return [list, datablock];
  const id = materialId(material);
  const field = f => {
    const { owner, key } = resolve(material, f.path);
    if (!owner || owner[key] === undefined) return null;
    if (f.texture) return row({ id: 'mat.' + id + '.' + f.path, label: f.label, reference: true, default: '', title: f.title, choices: () => library.images().map(p => [p, p]), get: () => material.metadata?.wbTextures?.[f.path] ?? (owner[key] ? owner[key].name : ''), set: v => library.setTexture(material, f.path, v) });
    const refs = f.animatable === false ? [] : f.color ? ['r', 'g', 'b'].map(c => address('material:' + id, f.path + '.' + c)) : [address('material:' + id, f.path)];
    return row({ id: 'mat.' + id + '.' + f.path, label: f.label, min: f.min, max: f.max, step: f.step, options: f.options, color: f.color,
      default: f.color ? undefined : typeof owner[key] === 'number' ? (f.min ?? 0) : owner[key],
      get: () => { const r = resolve(material, f.path); return r.owner?.[r.key]; },
      set: v => { const r = resolve(material, f.path); if (r.owner && (v !== undefined || !f.color)) r.owner[r.key] = f.color ? v.clone() : v; },
      refs: () => refs });
  };
  const sections = library.types[type]?.sections || [];
  const typeRow = row({ id: 'mat.' + id + '.type', label: 'Surface', options: Object.fromEntries(Object.entries(library.types).map(([k, t]) => [t.title, k])), default: type, get: () => type, set: v => library.convert(material, v) });
  const graphRows = () => {
    if (type !== 'node') return [];
    const rows = bindGraph(world.animation, { id: 'material:' + id + ':graph', title: material.name, graph: material, kind: 'material' }).map(f => row({ ...f, default: undefined }));
    return [...(rows.length ? rows : [h('p', { class: 'bl-message' }, 'No uniform inputs. Add Input blocks in the Shader Editor to expose values here.')]),
      h('button', { type: 'button', class: 'bl-wide-button', onClick: () => world.openNodeEditor?.('shader') }, [icon('NODE_MATERIAL'), 'Open in Shader Editor'])];
  };
  if (state.previewFor !== id) { state.previewFor = id; state.previewUrl = ''; }
  preview.request(material, url => { state.previewUrl = url; });
  return [
    list, datablock,
    panel('material.preview', 'Preview', () => [h('div', { class: 'bl-preview' }, state.previewUrl ? h('img', { src: state.previewUrl, alt: material.name + ' preview' }) : h('span', 'Rendering…'))]),
    panel('material.surface', 'Surface', () => [
      typeRow,
      ...graphRows(),
      ...sections.filter(s => s.id === 'surface').flatMap(s => s.fields.map(field)),
      ...sections.filter(s => s.sub).map(s => panel('material.' + s.id, s.title, () => s.fields.map(field), { subpanel: true, defaultClosed: true })),
    ]),
    ...sections.filter(s => s.id === 'settings').map(s => panel('material.settings', s.title, () => s.fields.map(field), { defaultClosed: true })),
  ];
}
