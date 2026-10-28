// A header drawn from Blender's scripts (a Header class's draw, recorded by ui-layout.js with ui.header set): its menus
// as pull-downs, operators and bound properties as buttons, other properties as toggles and fields of their RNA data,
// popovers as buttons for the panels they open, and spacers between groups.
import { drawMenu, subitems } from './ui-layout.js';
import { menuButton } from './menu.js';
import { iconEl } from './icon.js';

const titleCase = (identifier) => identifier.toLowerCase().split('_').map((w) => (w[0] ?? '').toUpperCase() + w.slice(1)).join(' ');
const element = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className, ...props });

function button(item, { label, icon, title, pressed, run }) {
  const b = element('button', 'bl-icon-button' + (label ? ' bl-text-toggle' : ''), { type: 'button', title: title ?? label ?? '' });
  if (icon) b.append(iconEl(icon));
  if (label) b.append(element('span', '', { textContent: label }));
  if (item.blender) b.dataset.blender = item.blender;
  b.onclick = (e) => { e.stopPropagation(); run(); };
  b.refresh = () => {
    b.disabled = item.enabled?.() === false;
    if (pressed) b.setAttribute('aria-pressed', String(!!pressed()));
  };
  return b;
}

// A property of RNA data: a toggle for a boolean, a field for a number, its value for the rest.
function property(item, { name, data, text, icon, iconOnly }, changed) {
  const value = data[name], label = iconOnly ? '' : text ?? titleCase(name);
  if (typeof value === 'boolean') {
    return button(item, { label: icon && text === '' ? '' : label, icon: icon && icon !== 'NONE' ? icon : value ? 'CHECKBOX_HLT' : 'CHECKBOX_DEHLT', title: label || name,
      pressed: () => data[name], run: () => { data[name] = !data[name]; changed(); } });
  }
  if (typeof value === 'number') {
    const field = element('label', 'bl-header-field', { title: label || name });
    field.dataset.property = name;
    if (label) field.append(element('span', '', { textContent: label }));
    const input = element('input', '', { type: 'number', value: String(value), step: Number.isInteger(value) ? '1' : 'any' });
    input.onchange = () => { const n = Number(input.value); if (Number.isFinite(n)) { data[name] = n; changed(); } };
    field.append(input);
    field.refresh = () => { if (document.activeElement !== input) input.value = String(data[name]); input.disabled = item.enabled?.() === false; };
    return field;
  }
  // An enum shows its value until RNA UI data gives its items' names and icons.
  const shown = element('span', 'bl-header-value', { title: label || name });
  shown.refresh = () => {
    shown.replaceChildren(iconOnly ? iconEl('DOWNARROW_HLT') : titleCase(String(data[name] ?? '')));
  };
  return shown;
}

// Draws the header `idname` into host (replacing what it held); `changed()` follows a property edit. Returns refresh(),
// which updates states in place.
export function drawHeader(host, idname, ui, { changed = () => {} } = {}) {
  const items = drawMenu(idname, { ...ui, header: true });
  const parts = items.map((item) => {
    if (item === '-') return element('span', 'bl-sep');
    if (item.spacer) return element('span', 'bl-header-spacer');
    if (item.property) return property(item, item.property, changed);
    if (item.popover) return button(item, { label: item.label, icon: item.icon ?? 'DOWNARROW_HLT', title: item.label || item.popover, run: () => ui.popover?.(item.popover) });
    if (item.items) return menuButton(item.label, () => subitems(item), { blender: item.blender, icon: item.icon });
    return button(item, { label: item.iconOnly || (item.icon && !item.label) ? '' : item.label, icon: item.icon, title: item.label,
      pressed: item.checked, run: () => { item.run(); changed(); } });
  });
  host.replaceChildren(...parts);
  const refresh = () => parts.forEach((part) => part.refresh?.());
  refresh();
  return refresh;
}
