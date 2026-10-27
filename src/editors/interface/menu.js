import { keysLabel } from '../../windowmanager/input/keymap.js';
import { iconEl } from './icon.js';

const stack = [];
let bar = null;
const resolve = items => (typeof items === 'function' ? items() : items);

function closeFrom(level) {
  while (stack.length > level) stack.pop().el.remove();
  if (!stack.length && bar) { bar.button.classList.remove('open'); bar = null; }
}
export const closeMenus = () => closeFrom(0);

function place(el, rect, side) {
  document.body.append(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = side ? rect.right - 2 : rect.left, y = side ? rect.top - 4 : rect.bottom + 1;
  if (x + w > innerWidth - 4) x = side ? rect.left - w + 2 : innerWidth - w - 4;
  if (y + h > innerHeight - 4) y = side ? innerHeight - h - 4 : Math.max(4, rect.top - h - 1);
  el.style.left = Math.max(4, x) + 'px';
  el.style.top = Math.max(4, y) + 'px';
}

function render(items, rect, level, side = false, title) {
  closeFrom(level);
  const el = document.createElement('div');
  el.className = 'bl-menu';
  el.setAttribute('role', 'menu');
  if (title) {
    const t = document.createElement('div');
    t.className = 'bl-menu-title';
    t.textContent = title;
    el.append(t);
  }
  for (const item of resolve(items)) {
    if (!item) continue;
    if (item === '-') { el.append(Object.assign(document.createElement('hr'), { className: 'bl-menu-sep' })); continue; }
    if (item.heading) { el.append(Object.assign(document.createElement('div'), { className: 'bl-menu-heading', textContent: item.heading })); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    const checked = item.checked?.();
    b.append(
      checked === undefined ? item.icon ? iconEl(item.icon) : Object.assign(document.createElement('span'), { className: 'bl-icon blank' }) : iconEl(checked ? 'checkbox_hlt' : 'checkbox_dehlt'),
      Object.assign(document.createElement('span'), { className: 'bl-menu-label', textContent: item.label }),
      Object.assign(document.createElement('kbd'), { textContent: item.items ? '' : keysLabel(item.keys) }),
    );
    if (item.items) b.append(iconEl('disclosure_tri_right', 'bl-menu-arrow'));
    b.disabled = item.enabled ? !item.enabled() : false;
    if (item.title) b.title = item.title;
    const sub = () => render(item.items, b.getBoundingClientRect(), level + 1, true);
    b.onpointerenter = () => (item.items && !b.disabled ? sub() : closeFrom(level + 1));
    b.onclick = e => {
      e.stopPropagation();
      if (item.items) return sub();
      closeMenus();
      item.run?.();
    };
    el.append(b);
  }
  stack.push({ el });
  place(el, rect, side);
  return el;
}

export function openMenu(items, at, title) {
  const rect = at instanceof Element ? at.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y };
  closeMenus();
  return render(items, rect, 0, false, title);
}

export function menuButton(label, items, { icon, className = '', title, blender } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  if (blender) button.dataset.blender = blender;
  button.className = 'bl-pulldown ' + className;
  if (title) button.title = title;
  if (icon) button.append(iconEl(icon));
  if (label) button.append(Object.assign(document.createElement('span'), { textContent: label }));
  const open = () => {
    openMenu(items, button);
    bar = { button };
    button.classList.add('open');
  };
  button.onclick = e => {
    e.stopPropagation();
    bar?.button === button ? closeMenus() : open();
  };
  button.onpointerenter = () => {
    if (bar && bar.button !== button && bar.button.parentElement === button.parentElement) open();
  };
  return button;
}

addEventListener('pointerdown', e => { if (stack.length && !e.target.closest('.bl-menu,.bl-pulldown.open')) closeMenus(); }, true);
addEventListener('keydown', e => {
  if (!stack.length) return;
  const menu = stack.at(-1).el, buttons = [...menu.querySelectorAll('button:not(:disabled)')];
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFrom(stack.length - 1); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }
}, true);
addEventListener('blur', closeMenus);
