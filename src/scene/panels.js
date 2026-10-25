import { h } from 'vue';
import { Color3 } from '@babylonjs/core';
import { icon, iconButton } from '../properties/icons.js';
import { openMenu } from '../ui/menu.js';
import { address } from '../animation/model.js';
import { lengthUnitOptions, unitDefaults } from '../properties/units.js';
import { getPath } from './world.js';

const vector = (row, label, axes) => h('div', { class: 'bl-vector' }, axes.map((field, i) => row({ ...field, label: (i === 0 ? label + ' ' : '') + 'XYZ'[i] })));
const headerToggle = (checked, title, onChange) => () => [h('input', { type: 'checkbox', class: 'bl-panel-check', checked, title, 'aria-label': title, onChange: e => onChange(e.target.checked) })];
const linked = (label, children) => h('div', { class: 'bl-node-view' }, children);

export function scenePanels({ world, row, panel }) {
  const settings = world.sceneSettings, s = settings.state, none = s.unitSettings.system === 'NONE';
  const unit = (key, label, extra = {}) => row({ id: 'scene.unitSettings.' + key, label, default: unitDefaults[key], get: () => settings.state.unitSettings[key], set: v => settings.set('unitSettings.' + key, v), ...extra });
  return [
    h('div', { class: 'bl-id-row' }, [
      h('button', { type: 'button', class: 'bl-id-browse', title: 'Browse Scene to be linked', onClick: e => openMenu([{ heading: 'Browse Scene to be linked' }, { label: s.name, icon: 'scene_data', checked: () => true, run: () => {} }], e.currentTarget) }, [icon('SCENE_DATA')]),
      h('input', { class: 'bl-id-name', value: s.name, 'aria-label': 'Scene name', onChange: e => e.target.value.trim() && settings.set('name', e.target.value.trim()) }),
    ]),
    panel('scene.scene', 'Scene', () => [
      row({ id: 'scene.camera', label: 'Camera', reference: true, default: '', title: 'Active camera, used for camera view (Numpad 0) and rendering',
        choices: () => settings.cameras().map(c => [c.metadata?.wbId || c.name, c.name]),
        get: () => { const c = settings.camera(); return c ? c.metadata?.wbId || c.name : ''; },
        set: v => settings.set('camera', settings.cameras().find(c => (c.metadata?.wbId || c.name) === v) || null) }),
    ]),
    panel('scene.units', 'Units', () => [
      unit('system', 'Unit System', { options: { None: 'NONE', Metric: 'METRIC', Imperial: 'IMPERIAL' } }),
      unit('scale', 'Unit Scale', { default: 1, min: 1e-9, max: 1e9, step: 0.01, disabled: () => none }),
      unit('separate', 'Separate Units', { default: false, disabled: () => none }),
      unit('rotation', 'Rotation', { options: { Degrees: 'DEGREES', Radians: 'RADIANS' } }),
      unit('length', 'Length', { options: lengthUnitOptions(s.unitSettings.system), disabled: () => none }),
    ], { defaultClosed: true }),
    panel('scene.gravity', 'Gravity', () => [
      vector(row, 'Gravity', [0, 1, 2].map(i => ({ id: 'scene.gravity.' + i, default: [0, -9.807, 0][i], step: 0.1, disabled: () => !settings.state.useGravity,
        get: () => settings.state.gravity[i], set: (v, finish) => { const g = [...settings.state.gravity]; g[i] = v; settings.set('gravity', g, finish !== false); },
        refs: () => [address('scene', 'gravity.' + 'xyz'[i])] }))),
    ], { defaultClosed: true, actions: headerToggle(s.useGravity, 'Use Gravity', v => settings.set('useGravity', v)) }),
  ];
}

export function worldPanels({ world, row, panel, files = [] }) {
  const worlds = world.worlds, entry = worlds.active();
  const browse = e => openMenu([
    { heading: 'Browse World to be linked' },
    ...worlds.all().map(w => ({ label: w.name + (worlds.users(w) ? '' : '  (0)'), icon: 'world', checked: w === entry ? () => true : undefined, run: () => worlds.link(w) })),
  ], e.currentTarget);
  const datablock = h('div', { class: 'bl-id-row' }, entry ? [
    h('button', { type: 'button', class: 'bl-id-browse', title: 'Browse World to be linked', onClick: browse }, [icon('WORLD')]),
    h('input', { class: 'bl-id-name', value: entry.name, 'aria-label': 'World name', onChange: e => worlds.rename(entry, e.target.value) }),
    iconButton(entry.fakeUser ? 'FAKE_USER_ON' : 'FAKE_USER_OFF', 'Fake User · Keep this world even when unused', () => worlds.toggleFakeUser(entry), { 'aria-pressed': !!entry.fakeUser }),
    iconButton('DUPLICATE', 'New World · Duplicate this world', () => worlds.create(entry)),
    iconButton('X', 'Unlink World', () => worlds.unlink()),
  ] : [
    h('button', { type: 'button', class: 'bl-id-browse', title: 'Browse World to be linked', onClick: browse }, [icon('WORLD')]),
    h('button', { type: 'button', class: 'bl-id-new', onClick: () => worlds.create() }, [icon('ADD'), 'New']),
  ]);
  if (!entry) return [datablock];
  const id = entry.id, refs = path => () => [address('world:' + id, path)];
  const value = (path, label, extra = {}) => row({ id: 'world.' + id + '.' + path, label, get: () => getPath(worlds.byId(id), path), set: (v, finish) => worlds.set(worlds.byId(id), path, v, finish !== false), refs: refs(path), ...extra });
  const color = (path, label) => row({ id: 'world.' + id + '.' + path, label, color: true,
    get: () => Color3.FromArray(getPath(worlds.byId(id), path)), set: (v, finish) => worlds.set(worlds.byId(id), path, v.asArray(), finish !== false),
    refs: () => [0, 1, 2].map(i => address('world:' + id, path + '.' + i)) });
  const fog = entry.volume.type, input = entry.background.input;
  return [
    datablock,
    panel('world.surface', 'Surface', () => [
      h('div', { class: 'bl-property' }, [h('label', 'Surface'), h('span', { class: 'bl-node-link', title: 'Babylon has no world shader; this maps onto the scene background and environment' }, 'Background'), h('span')]),
      value('background.input', 'Color', { default: 'COLOR', options: { Color: 'COLOR', 'Environment Texture': 'ENVIRONMENT' }, refs: undefined }),
      h('div', { class: 'bl-node-inputs' }, input === 'COLOR'
        ? [color('background.color', 'Color')]
        : [value('background.image', 'Image', { reference: true, default: '', choices: () => worlds.images(files), refs: undefined }),
          value('background.rotation', 'Rotation', { default: 0, unit: 'angle', step: Math.PI / 180 })]),
      value('background.strength', 'Strength', { default: 1, min: 0, max: 1e6, step: 0.01 }),
    ]),
    panel('world.volume', 'Volume', () => [
      value('volume.type', 'Volume', { default: 'NONE', options: { None: 'NONE', 'Volume Scatter': 'SCATTER', 'Exponential Squared Fog': 'EXP2', 'Linear Fog': 'LINEAR' }, refs: undefined }),
      ...(fog === 'NONE' ? [] : [h('div', { class: 'bl-node-inputs' }, [
        color('volume.color', 'Color'),
        ...(fog === 'LINEAR'
          ? [value('volume.start', 'Start', { default: 10, min: 0, unit: 'length', step: 0.1 }), value('volume.end', 'End', { default: 100, min: 0, unit: 'length', step: 0.1 })]
          : [value('volume.density', 'Density', { default: 0.05, min: 0, max: 100, step: 0.001 })]),
      ])]),
      h('p', { class: 'bl-message' }, 'Babylon fog: shown in Rendered shading and camera view.'),
    ], { defaultClosed: fog === 'NONE' }),
    panel('world.settings', 'Settings', () => [
      panel('world.settings.visibility', 'Ray Visibility', () => [
        value('visibility.camera', 'Camera', { default: true, refs: undefined, description: 'Show the environment texture as the background (skybox). Off: the background uses the Color input.' }),
        ...(input === 'ENVIRONMENT' && !entry.visibility.camera ? [color('background.color', 'Background')] : []),
      ], { subpanel: true }),
    ], { defaultClosed: true }),
  ];
}
