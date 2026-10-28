// Pull-down, popup and sub-menus as Blender draws and handles them (interface_region_popup.cc,
// interface_region_menu_popup.cc, interface_handlers.cc). Sizes are multiples of the UI unit (--bl-row).
import { keysLabel } from '../../windowmanager/input/keymap.js';
import { iconEl } from './icon.js';

// Blender's timings in ms (sub-menu auto-open, auto-scroll, towards-submenu grace) and its fixed screen margin in px.
const SUBMENU_DELAY = 200, SCROLL_INTERVAL = 100, TOWARDS_TIMEOUT = 1000, TOWARDS_MARGIN = 20, SCREEN_MARGIN = 10;

const levels = [];
const memory = new Map();
const pointer = { x: 0, y: 0 };
let bar = null, towards = null, dragOpened = false;

const resolve = items => (typeof items === 'function' ? items() : items);
const unit = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bl-row'));
const make = (tag, className, text) => Object.assign(document.createElement(tag), { className }, text === undefined ? {} : { textContent: text });
const isRow = item => item !== '-' && !item.heading;

function closeFrom(level) {
  while (levels.length > level) {
    const menu = levels.pop();
    clearTimeout(menu.timer);
    clearInterval(menu.scrollTimer);
    menu.el.remove();
  }
  levels.at(-1)?.el.classList.remove('sub-open');
  if (!levels.length && bar) { bar.button.classList.remove('open'); bar = null; }
}
export const closeMenus = () => closeFrom(0);

// Blender's menu_block_set_keyaccels: each entry takes the first letter of a word not yet taken, then any free letter;
// toggles wait for the second pass.
function accelerators(items) {
  const taken = new Set(), keys = new Map();
  for (const pass of [0, 1]) {
    for (const item of items) {
      if (keys.has(item) || !item.label || (pass === 0 && item.checked)) continue;
      const text = item.label;
      for (let i = 0; i < text.length;) {
        const letter = text[i].toLowerCase();
        if (letter >= 'a' && letter <= 'z' && !taken.has(letter)) { taken.add(letter); keys.set(item, letter); break; }
        if (pass === 1) { i++; continue; }
        while (/[a-z]/i.test(text[i] ?? '')) i++;
        i++;
      }
    }
  }
  return keys;
}

// The accelerator is underlined where it first appears upper case, else lower case.
function labelEl(text, key) {
  const label = make('span', 'bl-menu-label');
  const at = key ? [key.toUpperCase(), key].map(k => text.indexOf(k)).find(i => i >= 0) ?? -1 : -1;
  if (at < 0) label.textContent = text;
  else label.append(text.slice(0, at), make('u', '', text[at]), text.slice(at + 1));
  return label;
}

function rowEl(menu, item, key, level) {
  const b = make('button', 'bl-menu-item');
  b.type = 'button';
  b.tabIndex = -1;
  b.setAttribute('role', 'menuitem');
  const checked = item.checked?.(), shortcut = keysLabel(item.keys);
  b.append(
    checked !== undefined ? iconEl(checked ? 'checkbox_hlt' : 'checkbox_dehlt')
      : item.image ? Object.assign(make('img', 'bl-icon bl-icon-image'), { src: item.image, alt: '' })
      : item.icon ? iconEl(item.icon) : make('span', 'bl-icon blank'),
    labelEl(item.label, key),
  );
  if (shortcut) b.append(make('kbd', '', shortcut));
  if (item.items) b.append(make('span', 'bl-menu-arrow'));
  const disabled = item.enabled ? !item.enabled() : false;
  b.classList.toggle('disabled', disabled);
  b.setAttribute('aria-disabled', disabled);
  if (item.title) b.title = item.title;
  const index = menu.rows.push({ el: b, item, key, disabled }) - 1;
  b.onpointermove = e => hover(level, index, e);
  b.onpointerleave = () => leave(level, index);
  b.onclick = e => { e.stopPropagation(); activate(level, index); };
  b.onpointerup = e => { if (dragOpened && !e.button) activate(level, index); };
  return b;
}

// A menu that searches as it is typed in (SEARCH_ON_KEY_PRESS) has no accelerator keys.
function render(items, anchor, level, title, search) {
  closeFrom(level);
  const menu = { el: make('div', 'bl-menu ' + anchor.kind), list: make('div', 'bl-menu-list'), rows: [], active: -1, anchor, level };
  menu.el.setAttribute('role', 'menu');
  if (anchor.scale > 1) menu.el.style.setProperty('--u', `calc(var(--bl-row) * ${anchor.scale})`);
  menu.el.append(menu.list, make('div', 'bl-menu-scroll up'), make('div', 'bl-menu-scroll down'));
  if (title) menu.list.append(make('div', 'bl-menu-title', title), make('hr', 'bl-menu-sep'));
  const entries = resolve(items).filter(Boolean), keys = search ? new Map() : accelerators(entries.filter(isRow));
  menu.el.classList.toggle('has-sub', entries.some(item => item.items));
  for (const item of entries) {
    if (item === '-') menu.list.append(make('hr', 'bl-menu-sep'));
    else if (item.heading) menu.list.append(make('div', 'bl-menu-heading', item.heading));
    else menu.list.append(rowEl(menu, item, keys.get(item), level));
  }
  levels.push(menu);
  document.body.append(menu.el);
  place(menu);
  menu.el.onpointermove = e => { menu.el.classList.remove('keyboard'); if (towards && levels.at(-1) === menu) Object.assign(towards, { x: e.clientX, y: e.clientY, time: performance.now() }); autoScroll(menu); };
  menu.el.addEventListener('wheel', e => { e.preventDefault(); wheel(menu, e.deltaY > 0 ? 1 : -1); }, { passive: false });
  return menu;
}

function setActive(menu, index, reveal = false) {
  menu.rows[menu.active]?.el.classList.remove('current');
  menu.active = index;
  const row = menu.rows[index];
  if (!row) return;
  row.el.classList.add('current');
  // A row the keys moved to is the one highlighted, not the one under the pointer, until the pointer moves.
  menu.el.classList.toggle('keyboard', reveal);
  if (reveal) revealRow(menu, row.el);
}

// Blender's mouse_motion_towards_check: while the pointer heads for an open sub-menu, rows it crosses on the way
// do not take over.
function headingToSubmenu(level, e) {
  const sub = levels[level + 1];
  if (!sub || !towards) return false;
  if (Math.hypot(e.clientX - towards.x, e.clientY - towards.y) < 4) return true;
  if (performance.now() - towards.time <= TOWARDS_TIMEOUT) {
    const r = sub.el.getBoundingClientRect(), m = TOWARDS_MARGIN, p = [e.clientX, e.clientY], o = [towards.x, towards.y];
    const corners = [[r.left - m, r.bottom + m], [r.right + m, r.bottom + m], [r.right + m, r.top - m], [r.left - m, r.top - m]];
    if (corners.some((c, i) => inTriangle(p, o, c, corners[(i + 1) % 4]))) return true;
  }
  towards = null;
  return false;
}

function inTriangle([x, y], a, b, c) {
  const side = (p, q) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
  const d1 = side(a, b), d2 = side(b, c), d3 = side(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function hover(level, index, e) {
  const menu = levels[level];
  if (!menu || menu.active === index || headingToSubmenu(level, e)) return;
  clearTimeout(menu.timer);
  closeFrom(level + 1);
  setActive(menu, index);
  const { item, disabled } = menu.rows[index];
  if (item.items && !disabled) menu.timer = setTimeout(() => openSubmenu(level, index), SUBMENU_DELAY);
}

function leave(level, index) {
  const menu = levels[level];
  if (!menu || menu.active !== index || levels[level + 1]) return;
  clearTimeout(menu.timer);
  setActive(menu, -1);
}

function activate(level, index, fromKeyboard = false) {
  const menu = levels[level], row = menu?.rows[index];
  if (!row || row.disabled) return;
  if (row.item.items) return openSubmenu(level, index, fromKeyboard);
  if (menu.anchor.kind === 'popup') memory.set(menu.anchor.title, row.item.label);
  closeMenus();
  row.item.run?.();
}

function openSubmenu(level, index, fromKeyboard = false) {
  const menu = levels[level], row = menu.rows[index];
  clearTimeout(menu.timer);
  setActive(menu, index);
  if (levels[level + 1]?.parentIndex === index) return;
  const frame = menu.el.getBoundingClientRect(), r = row.el.getBoundingClientRect();
  const sub = render(row.item.items, { kind: 'submenu', rect: { left: frame.left, right: frame.right, top: r.top, bottom: r.bottom, width: frame.width } }, level + 1);
  sub.parentIndex = index;
  menu.el.classList.add('sub-open');
  towards = { ...pointer, time: performance.now() };
  if (fromKeyboard) setActive(sub, 0, true);
}

// Blender's popup_block_position: pull-downs open below their button, left-aligned; sub-menus to the right of their
// row; each flips only when the other side has room.
function attach(w, h, r, kind, u) {
  const pad = Math.floor(u * 0.2), sizeX = w + 0.2 * u, sizeY = h + 0.2 * u;
  const left = r.left - sizeX > 0, right = r.right + sizeX < innerWidth;
  let down = r.bottom + sizeY < innerHeight, up = r.top - sizeY > 0;
  if (!up && !down) innerHeight - r.bottom < r.top ? (up = true) : (down = true);
  let [dir1, dir2] = kind === 'submenu' ? ['right', 'down'] : ['down', 'left'];
  if (left || right) {
    if (dir1 === 'right' && !right) dir1 = 'left';
    if (dir2 === 'left' && !right) dir2 = 'right';
  }
  if (dir1 === 'down' && !down) dir1 = 'up';
  if (dir2 === 'down' && !down) dir2 = 'up';
  if (kind === 'submenu') {
    // Blender draws a sub-menu one pixel above its first row's alignment with the parent row.
    const y = dir2 === 'down' ? r.top - pad - 1 : r.bottom + pad - h;
    return { x: dir1 === 'right' ? r.right - 1 : r.left - w + 1, y, square: '' };
  }
  const aligned = w <= r.width + 1, edge = dir1 === 'down' ? 't' : 'b';
  const square = aligned ? `${edge}l ${edge}r` : edge + (dir2 === 'left' ? 'l' : 'r');
  return { x: dir2 === 'left' ? r.left : r.right - w, y: dir1 === 'down' ? r.bottom - 1 : r.top + 1 - h, square };
}

function place(menu) {
  const { el, list, anchor } = menu, u = unit(), top = u * 0.5, bottom = innerHeight - SCREEN_MARGIN;
  el.style.minWidth = (anchor.kind === 'popup' || !anchor.rect.width ? 9 * u : anchor.rect.width) + 'px';
  let w = Math.ceil(el.getBoundingClientRect().width);
  el.style.width = w + 'px';
  const h = el.offsetHeight;
  if (anchor.kind === 'pulldown' && w - anchor.rect.width >= 0 && w - anchor.rect.width < 0.5 * u) el.style.width = (w = anchor.rect.width) + 'px';
  let x, y, square = '';
  if (anchor.kind === 'popup') {
    // Blender's block_func_POPUP: the pointer lands at 0.8 of the width, on the last chosen entry or below the title.
    const remembered = menu.rows.findIndex(row => row.item.label === memory.get(anchor.title));
    x = anchor.x - 0.8 * w;
    y = remembered >= 0 ? anchor.y - menu.rows[remembered].el.offsetTop - 0.5 * u : anchor.y - 2.1 * u;
    y = Math.min(Math.max(y, top), bottom - h);
    menu.active = Math.max(remembered, 0);
  } else ({ x, y, square } = attach(w, h, anchor.rect, anchor.kind, u));
  x = Math.round(Math.max(SCREEN_MARGIN, Math.min(x, innerWidth - SCREEN_MARGIN - w)));
  y = Math.round(y);
  const clippedTop = Math.max(y, top), clippedBottom = Math.min(y + h, bottom);
  el.dataset.square = square;
  el.style.left = x + 'px';
  el.style.top = clippedTop + 'px';
  if (clippedBottom - clippedTop < h) el.style.height = clippedBottom - clippedTop + 'px';
  list.scrollTop = clippedTop - y;
  updateClip(menu);
  if (anchor.kind === 'popup') setActive(menu, menu.active, true);
}

const scrollZone = u => u * 0.7;

function updateClip(menu) {
  const { list } = menu;
  menu.el.classList.toggle('clip-top', list.scrollTop > 0);
  menu.el.classList.toggle('clip-bottom', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
}

function scrollBy(menu, dy) {
  menu.list.scrollTop += dy;
  updateClip(menu);
}

// Hovering a clipped end scrolls one row per interval, as Blender's menu_scroll_test timer does.
function autoScroll(menu) {
  const zone = () => {
    const r = menu.el.getBoundingClientRect(), z = scrollZone(unit());
    if (pointer.x < r.left || pointer.x > r.right) return 0;
    if (menu.el.classList.contains('clip-top') && pointer.y < r.top + z) return -1;
    if (menu.el.classList.contains('clip-bottom') && pointer.y > r.bottom - z) return 1;
    return 0;
  };
  if (menu.scrollTimer || !zone()) return;
  menu.scrollTimer = setInterval(() => {
    const dir = zone();
    if (dir) scrollBy(menu, dir * unit());
    else { clearInterval(menu.scrollTimer); menu.scrollTimer = null; }
  }, SCROLL_INTERVAL);
}

function revealRow(menu, row) {
  const { list } = menu, z = list.scrollHeight > list.clientHeight ? scrollZone(unit()) : 0;
  if (row.offsetTop < list.scrollTop + z) scrollBy(menu, row.offsetTop - z - list.scrollTop);
  else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight - z) scrollBy(menu, row.offsetTop + row.offsetHeight + z - list.scrollTop - list.clientHeight);
}

// The wheel scrolls a clipped menu, else moves the highlight like the arrow keys.
function wheel(menu, dir) {
  if (menu.list.scrollHeight > menu.list.clientHeight) scrollBy(menu, dir * unit());
  else step(menu, dir);
}

function step(menu, dir) {
  const n = menu.rows.length;
  if (!n) return;
  const next = menu.active < 0 ? (dir > 0 ? 0 : n - 1) : (menu.active + dir + n) % n;
  closeFrom(menu.level + 1);
  setActive(menu, next, true);
}

// At an element, a pull-down below it, or with `side` beside it (a toolbar button's, UI_DIR_RIGHT); at a point, a popup.
// `scale` is the layout's scale_y; `hold` lets the press that opened it run the entry it is released over
// (BLOCK_POPUP_HOLD). `search` makes the menu one Blender opens with SEARCH_ON_KEY_PRESS: typing searches what
// search() gives, every entry of the menu and its sub-menus as { path: [sub-menu labels], item }.
export function openMenu(items, at, title, { side = false, scale = 1, hold = false, search } = {}) {
  const anchor = at instanceof Element
    ? side ? { kind: 'submenu', rect: at.getBoundingClientRect() } : { kind: 'pulldown', rect: pulldownRect(at) }
    : { kind: 'popup', x: at.x, y: at.y, title: title ?? '' };
  closeMenus();
  dragOpened = hold;
  const menu = render(items, { ...anchor, scale }, 0, title, search);
  menu.search = search;
  return menu.el;
}

// Blender's menu search (ui_searchbox, with the menu's entries as items): the query on top, then the entries whose
// path and label hold every word typed, those whose label starts with the query first, each as its path, grey, then
// its label.
export function searchMenu(query, menu = levels[0]) {
  if (!menu?.search) return;
  closeFrom(menu.level + 1);
  menu.query = query;
  menu.entries ??= menu.search();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean), text = (e) => [...e.path, e.item.label].join(' ').toLowerCase();
  const score = (e) => (e.item.label.toLowerCase().startsWith(words[0] ?? '') ? 0 : 1) + (e.item.enabled?.() === false ? 4 : 0) + (e.item.weight ?? 0);
  const hits = menu.entries.filter((e) => words.every((w) => text(e).includes(w))).sort((a, b) => score(a) - score(b)).slice(0, 40);
  const field = make('div', 'bl-menu-search');
  field.append(iconEl('viewzoom'), make('span', '', query), make('span', 'bl-menu-caret'));
  menu.rows = [];
  menu.list.replaceChildren(field, ...hits.map((hit) => {
    const row = rowEl(menu, hit.item, null, menu.level);
    row.querySelector('.bl-menu-label').prepend(...hit.path.map((part) => make('span', 'bl-menu-path', part + ' \u25B8 ')));
    return row;
  }));
  menu.el.classList.add('searching');
  Object.assign(menu.el.style, { width: '', height: '' });
  setActive(menu, hits.length ? 0 : -1);
}

// A header pull-down's menu attaches one pixel out at its sides and at its bottom edge (measured on Blender 5.2.3).
function pulldownRect(button) {
  const r = button.getBoundingClientRect(), text = button.textContent.trim();
  if (!button.classList.contains('bl-pulldown')) return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: text ? r.width : 0 };
  return { left: r.left - 1, right: r.right + 1, top: r.top - 1, bottom: r.bottom, width: text ? r.width + 2 : 0 };
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
  const toggle = () => (bar?.button === button ? closeMenus() : open());
  // Blender opens a pull-down on press, so a drag to an entry and release runs it.
  button.onpointerdown = e => {
    if (e.button) return;
    e.stopPropagation();
    toggle();
    dragOpened = !!bar;
  };
  button.onclick = e => {
    e.stopPropagation();
    if (!e.detail) toggle();
  };
  button.onpointerenter = () => {
    if (bar && bar.button !== button && bar.button.parentElement === button.parentElement) open();
  };
  return button;
}

const DIGITS = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit7: 7, Digit8: 8, Digit9: 9, Digit0: 10 };

// Blender's ui_handle_menu_event keys: arrows, Home/End, Enter, Escape, Left/Right for sub-menus, number keys and
// accelerator letters. A menu is modal, so other keys do not reach the editors.
function menuKey(e, menu) {
  const level = menu.level;
  const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey;
  switch (e.key) {
    case 'Escape': closeMenus(); return true;
    case 'ArrowDown': case 'ArrowUp': step(menu, e.key === 'ArrowDown' ? 1 : -1); return true;
    case 'Home': case 'PageUp': setActive(menu, 0, true); return true;
    case 'End': case 'PageDown': setActive(menu, menu.rows.length - 1, true); return true;
    case 'Enter': activate(level, menu.active, true); return true;
    case 'ArrowLeft': if (menu.anchor.kind !== 'popup') closeFrom(level); return true;
    case 'ArrowRight': {
      if (menu.active < 0) setActive(menu, 0, true);
      if (menu.rows[menu.active]?.item.items) activate(level, menu.active, true);
      return true;
    }
  }
  if (menu.search && level === 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'Backspace' && menu.query !== undefined) { searchMenu(menu.query.slice(0, -1)); return true; }
    if (e.key.length === 1 && (menu.query !== undefined || e.key !== ' ')) { searchMenu((menu.query ?? '') + e.key); return true; }
  }
  if (e.repeat || !plain) return false;
  const number = DIGITS[e.code] ?? DIGITS[e.code.replace('Numpad', 'Digit')];
  if (number) {
    const index = number + (e.altKey ? 10 : 0) - 1, row = menu.rows[index];
    if (row && !row.item.checked) activate(level, index, true);
    return true;
  }
  const letter = /^Key[A-Z]$/.test(e.code) && e.code.slice(3).toLowerCase();
  const index = letter ? menu.rows.findIndex(row => row.key === letter && !row.disabled) : -1;
  if (index >= 0) activate(level, index, true);
  return !!letter;
}

addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY; }, true);
addEventListener('pointerup', () => { dragOpened = false; });
addEventListener('pointerdown', e => { if (levels.length && !e.target.closest('.bl-menu,.bl-pulldown.open')) closeMenus(); }, true);
addEventListener('keydown', e => {
  if (!levels.length) return;
  if (menuKey(e, levels.at(-1))) e.preventDefault();
  e.stopImmediatePropagation();
}, true);
addEventListener('blur', closeMenus);
