// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The control panel (control-panel.js opens it): every control of the scene as Blender's properties editor draws one,
// under its ID and struct (control-panel-model.js), custom properties first, then the materials, then the rest. Rows
// left at Blender's defaults are hidden until Show All or a search shows them. Number fields drag (Shift: precise,
// Ctrl: snap, Escape: undo the drag), type (Enter or a click; arithmetic and units) and step with the arrow keys;
// Backspace resets a field to the scene's value, Ctrl+C and Ctrl+V copy and paste it, Ctrl+Shift+C copies its data path.
// An ID that one of Babylon's editors shows links to it (dev-tools.js).
import { atDefault, baseColor, clamp, componentLabel, dragScale, formatValue, hexOf, layout, matches, parseValue, rgbOf, snapped, snapStep, softRange, toDisplay } from './control-panel-model.js';

/** @typedef {import('./control-panel-model.js').Row} Row */
/** @typedef {import('./control-panel-model.js').Group} Group */
/** @typedef {import('./control-panel-model.js').Section} Section */
/** @typedef {import('./blend-scene.js').Control} Control */
/** @typedef {import('./blend-scene.js').Value} Value */

const STYLE = `
.panel{--s:var(--cp-scale,1);position:fixed;top:calc((var(--top) + 32px)/var(--s));right:calc(var(--right)/var(--s));zoom:var(--s);display:flex;flex-direction:column;box-sizing:border-box;width:300px;
  max-width:calc((100vw - 16px)/var(--s));max-height:calc((var(--height) - 32px)/var(--s));touch-action:pan-y;border-radius:var(--cp-radius);background:var(--bl-region);color:var(--bl-text);font:var(--cp-font-size)/1 var(--bl-font-family);
  box-shadow:inset 0 0 0 1px var(--bl-panel-outline),var(--bl-shadow-popup);user-select:none;-webkit-user-select:none;overflow:hidden}
.panel[hidden]{display:none}
.panel *{box-sizing:border-box}
.head{display:flex;gap:var(--cp-gap);align-items:center;padding:4px 30px 4px 4px;background:var(--bl-header)}
.search{flex:1;display:flex;align-items:center;gap:4px;height:var(--cp-row);padding:0 6px;border-radius:calc(var(--cp-row)/2);background:var(--bl-wcol-text);color:var(--bl-text-dim);box-shadow:inset 0 0 0 1px var(--bl-wcol-outline)}
.search:focus-within{box-shadow:inset 0 0 0 1px var(--bl-select)}
.search svg{width:12px;height:12px;flex:none}
.search input{flex:1;min-width:0;height:100%;border:0;outline:0;background:none;color:var(--bl-text);font:inherit;user-select:text}
.search input::-webkit-search-cancel-button{display:none}
.tool{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:var(--cp-row);height:var(--cp-row);padding:0 6px;border:0;border-radius:var(--cp-radius);
  background:var(--bl-wcol-option);color:var(--bl-text);font:inherit;cursor:pointer;white-space:nowrap}
.tool:hover{background:color-mix(in srgb,var(--bl-wcol-option),#fff 9%)}
.tool[aria-pressed=true],.tool[aria-checked=true]{background:var(--bl-wcol-option-sel);color:var(--bl-wcol-option-item)}
.tool:focus-visible,.num:focus-visible,.ghead:focus-visible,.check:focus-within,.swatch:focus-visible,select:focus-visible,.text:focus-visible{outline:1px solid var(--bl-select);outline-offset:-1px}
.tool svg{width:13px;height:13px}
.link{min-width:0;height:calc(var(--cp-row) - 4px);padding:0 4px;background:none;color:var(--bl-text-dim)}
.link:hover{background:var(--bl-hover);color:var(--bl-link)}
.body{flex:1;min-height:0;overflow:auto;padding:2px 4px 4px;scrollbar-width:thin;scrollbar-color:var(--bl-wcol-num) transparent;overscroll-behavior:contain}
.empty{padding:12px 8px;color:var(--bl-text-off);text-align:center;line-height:1.4}
.section{margin-top:4px;border-radius:var(--cp-radius);background:var(--bl-panel-back);box-shadow:inset 0 0 0 1px var(--bl-panel-outline)}
.section>.ghead{height:24px;font-weight:600;color:var(--bl-panel-title)}
.group{margin:2px 4px 4px;border-radius:var(--cp-radius);background:var(--bl-panel-sub-back)}
.group .group{margin:2px 0 2px 6px}
.ghead{display:flex;align-items:center;gap:4px;height:var(--cp-row);padding:0 4px;border-radius:var(--cp-radius);cursor:pointer;outline:0}
.ghead:hover{background:var(--bl-hover)}
.ghead .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ghead .kind{color:var(--bl-text-off)}
.share{color:var(--bl-text-off);font-variant-numeric:tabular-nums}
.order{width:auto;font-weight:400}.order[aria-pressed=true]{background:none;color:var(--bl-link)}
.tri{width:8px;height:8px;flex:none;background:var(--bl-text-dim);clip-path:polygon(15% 10%,85% 50%,15% 90%);transition:transform .1s}
[aria-expanded=true]>.tri{transform:rotate(90deg)}
.dot{width:8px;height:8px;flex:none;border-radius:2px;background:var(--bl-icon-scene)}
.dot.objects{background:var(--bl-icon-object)}.dot.lights,.dot.cameras,.dot.worlds{background:var(--bl-icon-object-data)}
.dot.materials{width:12px;height:12px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgb(255 255 255/.45),transparent 45%),radial-gradient(circle,transparent 55%,rgb(0 0 0/.25)),var(--tint,var(--bl-icon-shading))}
.dot.modifiers,.dot.node_groups{background:var(--bl-icon-modifier)}.dot.nodes{background:var(--bl-icon-shading);border-radius:50%}.dot.bones{background:var(--bl-icon-object-data);border-radius:50%}
.rows{padding:2px 4px 4px}
.row{display:flex;align-items:flex-start;gap:6px;margin-top:var(--cp-gap)}
[hidden]{display:none!important}
.label{flex:0 0 var(--bl-split-label);min-width:0;overflow:hidden;padding-top:4px;color:var(--bl-text-dim);text-align:right;text-overflow:ellipsis;white-space:nowrap}
.value{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.value.inline{flex-direction:row;gap:var(--cp-gap)}
.num,.text,select,.swatch{position:relative;display:flex;align-items:center;width:100%;height:var(--cp-row);padding:0 8px;border:0;border-radius:0;overflow:hidden;
  background:var(--bl-wcol-num);color:var(--bl-text);font:inherit;outline:0;box-shadow:inset 0 -1px var(--bl-wcol-emboss)}
.value>:first-child{border-top-left-radius:var(--cp-radius);border-top-right-radius:var(--cp-radius)}
.value>:last-child{border-bottom-left-radius:var(--cp-radius);border-bottom-right-radius:var(--cp-radius)}
.value.inline>*{border-radius:var(--cp-radius)}
.num{cursor:ew-resize;justify-content:center}
.num:hover,select:hover,.swatch:hover{background:color-mix(in srgb,var(--bl-wcol-num),#fff 9%)}
.num.dragging,.num.editing{background:var(--bl-wcol-num-sel)}
.num.changed .val,.num.changed .name{color:var(--bl-wcol-option-item)}
.num .name{position:absolute;left:8px;color:var(--bl-text-dim);pointer-events:none}
.num.component{justify-content:flex-end}
.num .val{position:relative;white-space:nowrap;pointer-events:none}
.num .fill{position:absolute;left:0;top:0;bottom:0;background:var(--bl-wcol-num-item);pointer-events:none}
.num .edit{position:absolute;inset:0;width:100%;padding:0 8px;border:0;outline:0;background:var(--bl-wcol-text);color:var(--bl-text);font:inherit;user-select:text;box-shadow:inset 0 0 0 1px var(--bl-select)}
.num.invalid{animation:invalid .25s}
@keyframes invalid{25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
.text{background:var(--bl-wcol-text);user-select:text;cursor:text}
select{appearance:none;padding-right:20px;background:var(--bl-wcol-menu) no-repeat right 6px center/8px 5px;color:var(--bl-wcol-menu-item);cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 5'%3E%3Cpath d='M.7.7 4 4 7.3.7' fill='none' stroke='%23d9d9d9' stroke-width='1.3' stroke-linecap='round'/%3E%3C/svg%3E")}
select option{background:var(--bl-wcol-menu);color:var(--bl-wcol-menu-item)}
.check{display:flex;align-items:center;gap:6px;height:var(--cp-row);padding-left:2px;border-radius:var(--cp-radius);cursor:pointer;color:var(--bl-text)}
.check input{appearance:none;flex:none;width:14px;height:14px;margin:0;border-radius:3px;background:var(--bl-wcol-option);outline:0;cursor:pointer;box-shadow:inset 0 -1px var(--bl-wcol-emboss)}
.check input:checked{background:var(--bl-wcol-option-sel) no-repeat center/10px;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M2 5.2 4.2 7.3 8 2.8' fill='none' stroke='%23fff' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.check:hover input{filter:brightness(1.15)}
.swatch{padding:0;cursor:pointer;background:none;box-shadow:inset 0 0 0 1px var(--bl-wcol-outline)}
.swatch .rgb{flex:1;height:100%}
.swatch .alpha{flex:0 0 30%;height:100%;background:conic-gradient(var(--bl-wcol-num) 25%,var(--bl-text-dim) 0 50%,var(--bl-wcol-num) 0 75%,var(--bl-text-dim) 0) 0 0/8px 8px}
.swatch .alpha i{display:block;width:100%;height:100%}
.swatch input{position:absolute;inset:0;opacity:0;pointer-events:none}
.expand{flex:none;width:var(--cp-row);padding:0;border-radius:var(--cp-radius);background:var(--bl-wcol-num)}
.expand .tri{margin:auto}
.segments{display:flex;flex-wrap:wrap;gap:1px}.segments .tool{flex:1;min-width:0;padding:0 2px;border-radius:0}
.segments .tool:first-child{border-radius:var(--cp-radius) 0 0 var(--cp-radius)}.segments .tool:last-child{border-radius:0 var(--cp-radius) var(--cp-radius) 0}
.foot{display:flex;gap:10px;min-height:20px;padding:4px 8px;background:var(--bl-header);color:var(--bl-text-off);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.foot kbd{padding:0 3px;border:1px solid var(--bl-wcol-num);border-radius:3px;font:inherit;color:var(--bl-text-dim)}
.menu{position:fixed;z-index:1;display:flex;flex-direction:column;min-width:180px;padding:4px 0;border-radius:var(--cp-radius);background:var(--bl-wcol-text);box-shadow:inset 0 0 0 1px var(--bl-panel-outline),var(--bl-shadow-menu)}
.menu button{display:flex;justify-content:space-between;gap:16px;height:var(--cp-row);padding:0 10px;border:0;background:none;color:var(--bl-wcol-menu-item);font:inherit;text-align:left;cursor:pointer}
.menu button:hover,.menu button:focus-visible{background:var(--bl-select);color:var(--bl-wcol-option-item);outline:0}
.menu kbd{font:inherit;color:var(--bl-text-off)}
@media (pointer:coarse){.panel{--cp-row:28px}.check input{width:18px;height:18px}}
@media (prefers-reduced-motion:reduce){.tri{transition:none}.num.invalid{animation:none}}`;

// The UI scale a pinch sets, as the app's Resolution Scale (wm-touch.js).
const SCALE_RANGE = [0.5, 2];

// Bylonder's own drawings.
const SEARCH_ICON = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="5" cy="5" r="3.6"/><path d="m7.7 7.7 3 3" stroke-linecap="round"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="m3 3 6 6M9 3 3 9"/></svg>';
const EDITOR_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1" y="2" width="4" height="4" rx="1"/><rect x="9" y="8" width="4" height="4" rx="1"/><path d="M5 4h2.5a1.5 1.5 0 0 1 1.5 1.5v4"/></svg>';

// Each navigation mode's name and how it moves (control-panel-camera.js).
const MODES = /** @type {Record<string, [string, string]>} */ ({ FIXED: ['Fixed', 'The camera as exported'], ORBIT: ['Orbit', '<kbd>Drag</kbd> turn <kbd>Wheel</kbd> zoom <kbd>Right drag</kbd> pan'],
  FLY: ['Fly', '<kbd>Drag</kbd> look <kbd>W A S D</kbd> move <kbd>E Q</kbd> up, down'], WALK: ['Walk', '<kbd>Drag</kbd> look <kbd>W A S D</kbd> walk'],
  JOYSTICKS: ['Sticks', 'Left thumb moves, right thumb looks'] });

const HINTS = { field: '<kbd>Drag</kbd> change <kbd>Ctrl</kbd> snap <kbd>Shift</kbd> precise <kbd>Esc</kbd> undo', drag: '<kbd>Ctrl</kbd> snap <kbd>Shift</kbd> precise <kbd>Esc</kbd> cancel',
  edit: '<kbd>Enter</kbd> confirm <kbd>Esc</kbd> cancel, units and arithmetic work', idle: 'Search with <kbd>Ctrl</kbd> <kbd>F</kbd>, close with <kbd>Esc</kbd>' };

/**
 * An element with its properties, attributes (`aria-*`, `data-*`) and children.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [props]
 * @param {(Node | string | null | undefined | false)[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role') node.setAttribute(key, String(value));
    else /** @type {any} */ (node)[key] = value;
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false).map((c) => /** @type {Node | string} */ (c)));
  return node;
}

/** Writes text to the clipboard where the page may. @param {string} text */
const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

/**
 * The control panel of a scene, in the shadow root of its button (control-panel.js).
 * @param {ShadowRoot} shadow
 * @param {import('./blend-scene.js').BlendScene} blend
 * @param {import('./control-panel.js').PanelOptions & { button: HTMLButtonElement, place: () => DOMRect,
 *   viewer: () => Promise<ReturnType<import('./control-panel-camera.js').createNavigation>> }} options
 */
export function createPanel(shadow, blend, { button, place, viewer, ...tools }) {
  const controls = blend.controls();
  const byPath = new Map(controls.map((c) => [c.path, c]));
  const bindOf = (/** @type {string} */ path) => /** @type {Record<string, any> | undefined} */ (blend.ir.properties[path]?.bind);
  const sections = layout(controls, (c) => c.type === 'STRING' && !!bindOf(c.path)?.image);
  const storageKey = `bylonder-control-panel:${location.pathname}`;
  /** @type {{ open: Record<string, boolean>, all?: boolean, scale?: number, byScreen?: boolean }} */
  const state = (() => { try { return { open: {}, ...JSON.parse(localStorage.getItem(storageKey) ?? '{}') }; } catch { return { open: {} }; } })();
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* storage may be off */ } };
  /** The rows the viewer changed, shown though they are back at Blender's default. @type {Set<string>} */
  const touched = new Set();
  /** Each drawn control's update, by path. @type {Map<string, ((value: Value) => void)[]>} */
  const views = new Map();
  const get = (/** @type {string} */ path) => blend.get(path);
  const set = (/** @type {string} */ path, /** @type {Value} */ value) => {
    const control = /** @type {Control} */ (byPath.get(path));
    blend.set(path, typeof control.default === 'number' ? clamp(Number(value), control) : value);
    touched.add(path.replace(/\[\d+\]$/, ''));
  };

  const search = el('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search controls', spellcheck: false });
  const all = el('button', { type: 'button', className: 'tool', textContent: 'All', title: "Show properties left at Blender's defaults", 'aria-pressed': String(!!state.all) });
  const inspector = el('button', { type: 'button', className: 'tool', title: "Babylon's Inspector", 'aria-label': "Babylon's Inspector", innerHTML: EDITOR_ICON });
  const body = el('div', { className: 'body' });
  const foot = el('div', { className: 'foot', innerHTML: HINTS.idle });
  const panel = el('section', { className: 'panel', role: 'dialog', 'aria-label': 'Controls', hidden: true }, [
    el('div', { className: 'head' }, [el('label', { className: 'search', innerHTML: SEARCH_ICON }, [search]), all, inspector]),
    body, foot,
  ]);
  const close = el('button', { type: 'button', className: 'tool link', title: 'Close', 'aria-label': 'Close', innerHTML: CLOSE_ICON });
  Object.assign(close.style, { position: 'absolute', top: '6px', right: '6px' });
  panel.append(close);
  shadow.append(el('style', { textContent: STYLE }), panel);
  const hint = (/** @type {keyof HINTS} */ kind) => { foot.innerHTML = HINTS[kind]; };
  const scaled = (/** @type {number} */ value) => panel.style.setProperty('--cp-scale', String(value));
  scaled(state.scale ?? 1);
  // Touch, as the app has it (wm-touch.js): one finger scrolls the panel or drags a field sideways, two pinch its scale.
  /** @type {Map<number, { x: number, y: number }>} */
  const fingers = new Map();
  /** @type {{ spread: number, scale: number } | null} */
  let pinch = null;
  const spread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  panel.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) pinch = { spread: spread(), scale: state.scale ?? 1 };
  }, true);
  panel.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || fingers.size !== 2) return;
    state.scale = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], pinch.scale * spread() / pinch.spread));
    scaled(state.scale);
  }, true);
  const lift = (/** @type {PointerEvent} */ e) => {
    fingers.delete(e.pointerId);
    if (pinch && fingers.size < 2) { pinch = null; save(); }
  };
  panel.addEventListener('pointerup', lift, true);
  panel.addEventListener('pointercancel', lift, true);

  // A number field of a control: its value, a slider's fill, a vector component's letter.
  /** @param {Control} control @param {{ slider?: boolean, component?: string }} [kind] */
  function numberField(control, { slider = false, component } = {}) {
    const { path } = control;
    const fill = slider ? el('span', { className: 'fill' }) : null, text = el('span', { className: 'val' });
    const field = el('div', { className: `num${component ? ' component' : ''}`, tabIndex: 0, role: 'spinbutton', 'aria-label': component ? `${component}` : undefined,
      title: `${control.name ?? ''}\n${path}` }, [fill, component && el('span', { className: 'name', textContent: component }), text]);
    const range = softRange(control);
    const show = (/** @type {Value} */ value) => {
      text.textContent = formatValue(value, control);
      field.setAttribute('aria-valuenow', String(value));
      field.classList.toggle('changed', value !== control.default);
      if (fill && range && typeof value === 'number') fill.style.width = `${Math.min(1, Math.max(0, (value - range[0]) / (range[1] - range[0]))) * 100}%`;
    };
    watch(path, show);
    const nudge = (/** @type {number} */ steps, /** @type {{ ctrlKey: boolean, shiftKey: boolean }} */ e) => {
      const value = /** @type {number} */ (get(path));
      set(path, e.ctrlKey ? snapped(value + steps * snapStep(control, e.shiftKey), snapStep(control, e.shiftKey)) : value + steps * dragScale(control) * (e.shiftKey ? 1 : 10));
    };
    let editing = false;
    const edit = (/** @type {string} */ typed = '') => {
      editing = true;
      field.classList.add('editing');
      hint('edit');
      const input = el('input', { className: 'edit', value: typed || formatValue(get(path), control), spellcheck: false, autocapitalize: 'off', enterKeyHint: 'done', 'aria-label': control.name ?? path });
      field.append(input);
      input.focus();
      if (!typed) input.select();
      let done = false;
      const finish = (/** @type {boolean} */ commit) => {
        if (done) return;
        done = true;
        const value = commit ? parseValue(input.value, control) : null;
        input.remove();
        editing = false;
        field.classList.remove('editing');
        hint('field');
        if (commit && value === null) {
          field.classList.remove('invalid');
          void field.offsetWidth;
          field.classList.add('invalid');
        } else if (value !== null) set(path, value);
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { finish(true); field.focus(); }
        if (e.key === 'Escape') { finish(false); field.focus(); }
      });
      input.addEventListener('blur', () => finish(true));
    };
    field.addEventListener('pointerdown', (down) => {
      if (down.button !== 0 || editing) return;
      down.preventDefault();
      field.focus();
      field.setPointerCapture(down.pointerId);
      const start = /** @type {number} */ (get(path));
      let raw = start, last = down.clientX, travel = 0, dragging = false;
      const move = (/** @type {PointerEvent} */ e) => {
        if (pinch) { set(path, start); end(); return; }
        // A finger moving more up or down than sideways scrolls the panel (the browser takes it), not the field.
        if (!dragging && e.pointerType === 'touch' && Math.abs(e.clientY - down.clientY) > Math.abs(e.clientX - down.clientX)) return;
        const dx = e.clientX - last;
        last = e.clientX;
        travel += Math.abs(dx);
        if (!dragging && travel < 3) return;
        if (!dragging) { dragging = true; field.classList.add('dragging'); hint('drag'); }
        raw = clamp(raw + dx * dragScale(control) * (e.shiftKey ? 0.1 : 1), control);
        set(path, e.ctrlKey ? snapped(raw, snapStep(control, e.shiftKey)) : raw);
      };
      const end = () => {
        field.removeEventListener('pointermove', move);
        field.removeEventListener('pointerup', up);
        field.removeEventListener('pointercancel', end);
        removeEventListener('keydown', cancel, true);
        field.classList.remove('dragging');
        hint('field');
      };
      const up = () => { end(); if (!dragging) edit(); };
      const cancel = (/** @type {KeyboardEvent} */ e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        set(path, start);
        if (field.hasPointerCapture(down.pointerId)) field.releasePointerCapture(down.pointerId);
        end();
      };
      field.addEventListener('pointermove', move);
      field.addEventListener('pointerup', up);
      field.addEventListener('pointercancel', end);
      addEventListener('keydown', cancel, true);
    });
    field.addEventListener('keydown', (e) => {
      if (editing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') nudge(e.key === 'ArrowUp' ? 1 : -1, e);
      else if (e.key === 'PageUp' || e.key === 'PageDown') nudge(e.key === 'PageUp' ? 10 : -10, e);
      else if ((e.key === 'Home' || e.key === 'End') && range) set(path, range[e.key === 'Home' ? 0 : 1]);
      else if (e.key === 'Enter' || e.key === 'F2') edit();
      else if (e.key === 'Backspace' || e.key === 'Delete') set(path, control.default);
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'c') copy(path);
      else if (ctrl && e.key.toLowerCase() === 'c') copy(String(get(path)));
      else if (ctrl && e.key.toLowerCase() === 'v') navigator.clipboard?.readText().then((t) => { const v = parseValue(t, control); if (v !== null) set(path, v); }, () => {});
      else if (!ctrl && !e.altKey && /^[-+\d.(]$/.test(e.key)) { e.preventDefault(); edit(e.key); return; }
      else return;
      e.preventDefault();
    });
    field.addEventListener('wheel', (e) => { if (e.ctrlKey && !editing) { e.preventDefault(); nudge(e.deltaY < 0 ? 1 : -1, e); } }, { passive: false });
    field.addEventListener('pointerenter', () => { if (!editing) hint('field'); });
    field.addEventListener('pointerleave', () => { if (!editing && !field.classList.contains('dragging')) hint('idle'); });
    field.addEventListener('contextmenu', (e) => contextMenu(e, control));
    return field;
  }

  // Blender's context menu of a property, its items that apply to a page.
  /** @param {MouseEvent} e @param {Control} control */
  function contextMenu(e, control) {
    e.preventDefault();
    const items = /** @type {[string, string, () => void][]} */ ([
      ['Reset to Default Value', 'Backspace', () => set(control.path, control.default)],
      ...(control.blender_default !== undefined ? /** @type {[string, string, () => void][]} */ ([["Reset to Blender's Default", '', () => set(control.path, /** @type {Value} */ (control.blender_default))]]) : []),
      ['Copy Value', 'Ctrl C', () => copy(String(get(control.path)))],
      ['Copy Data Path', 'Ctrl Shift C', () => copy(control.path)],
    ]);
    const menu = el('div', { className: 'menu', role: 'menu' }, items.map(([label, keys, run]) => el('button', { type: 'button', role: 'menuitem', onclick: () => { run(); dismiss(); } }, [label, el('kbd', { textContent: keys })])));
    Object.assign(menu.style, { left: `${Math.min(e.clientX, innerWidth - 200)}px`, top: `${Math.min(e.clientY, innerHeight - 100)}px` });
    shadow.append(menu);
    /** @type {HTMLElement} */ (menu.firstElementChild).focus();
    const away = (/** @type {Event} */ ev) => { if (!ev.composedPath().includes(menu)) dismiss(); };
    const keys = (/** @type {KeyboardEvent} */ ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); dismiss(); } };
    const dismiss = () => { menu.remove(); removeEventListener('pointerdown', away, true); removeEventListener('keydown', keys, true); };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', keys, true);
  }

  /** @param {string} path @param {(value: Value) => void} show */
  function watch(path, show) {
    views.set(path, [...(views.get(path) ?? []), show]);
    show(get(path));
  }

  // A color's swatch, as Blender draws it (alpha over a checker), which opens the browser's picker, and its components.
  /** @param {Row} row */
  function colorWidget(row) {
    const gamma = row.controls[0].subtype === 'COLOR_GAMMA';
    const rgb = el('span', { className: 'rgb' }), alpha = row.controls[3] && el('i');
    const picker = el('input', { type: 'color', tabIndex: -1, 'aria-hidden': 'true' });
    const swatch = el('button', { type: 'button', className: 'swatch', title: `${row.label}\n${row.key}`, 'aria-label': row.label }, [rgb, alpha && el('span', { className: 'alpha' }, [alpha]), picker]);
    const components = el('div', { className: 'value', hidden: true }, row.controls.map((c, i) => numberField(c, { slider: true, component: componentLabel(c, i) })));
    const expand = el('button', { type: 'button', className: 'tool expand', title: 'Values', 'aria-label': `${row.label} values`, 'aria-expanded': 'false' }, [el('span', { className: 'tri' })]);
    expand.addEventListener('click', () => { components.hidden = !components.hidden; expand.setAttribute('aria-expanded', String(!components.hidden)); });
    const show = () => {
      const [r, g, b, a] = row.controls.map((c) => /** @type {number} */ (get(c.path)));
      rgb.style.background = cssOf(row);
      if (alpha) alpha.style.background = cssOf(row, a);
      picker.value = hexOf([r, g, b], gamma);
    };
    for (const c of row.controls) watch(c.path, show);
    swatch.addEventListener('click', () => (picker.showPicker ? picker.showPicker() : picker.click()));
    picker.addEventListener('input', () => rgbOf(picker.value, gamma).forEach((v, i) => set(row.controls[i].path, v)));
    swatch.addEventListener('contextmenu', (e) => contextMenu(e, row.controls[0]));
    return [el('div', { className: 'value inline' }, [swatch, expand]), components];
  }

  /** A color row's value as CSS, display encoded. @param {Row} row @param {number} [alpha] */
  function cssOf(row, alpha) {
    const gamma = row.controls[0].subtype === 'COLOR_GAMMA';
    const byte = (/** @type {Control} */ c) => { const v = Number(get(c.path)); return Math.round((gamma ? Math.min(1, Math.max(0, v)) : toDisplay(v)) * 255); };
    return `rgb(${row.controls.slice(0, 3).map(byte).join(' ')}${alpha === undefined ? '' : ` / ${alpha}`})`;
  }

  /** @param {Row} row */
  function widget(row) {
    const [control] = row.controls;
    if (row.widget === 'check') {
      const input = el('input', { type: 'checkbox', checked: !!get(control.path) });
      input.addEventListener('change', () => set(control.path, input.checked));
      watch(control.path, (v) => { input.checked = !!v; });
      return [el('label', { className: 'check', title: control.path }, [input, row.label])];
    }
    if (row.widget === 'enum' || row.widget === 'text') {
      const input = row.widget === 'enum'
        ? el('select', { 'aria-label': row.label, title: control.path }, (row.items ?? []).map((item) => el('option', { value: item, textContent: item.replace(/^.*\//, '') })))
        : el('input', { className: 'text', type: 'text', 'aria-label': row.label, title: control.path, spellcheck: false });
      input.addEventListener('change', () => set(control.path, input.value));
      input.addEventListener('keydown', (e) => e.stopPropagation());
      watch(control.path, (v) => { input.value = String(v); });
      return [el('div', { className: 'value' }, [input])];
    }
    if (row.widget === 'color') return colorWidget(row);
    const vector = row.controls.length > 1;
    return [el('div', { className: 'value' }, row.controls.map((c, i) => numberField(c, { slider: row.widget === 'slider', component: vector ? componentLabel(c, i) : undefined })))];
  }

  /** @param {Row} row */
  function rowElement(row) {
    const label = row.widget === 'check' ? '' : row.label;
    const [value, extra] = widget(row);
    const element = el('div', { className: 'row', 'data-path': row.key }, [el('span', { className: 'label', textContent: label, title: label }), value]);
    return extra ? [element, el('div', { className: 'row' }, [el('span', { className: 'label' }), extra])] : [element];
  }

  // Which of Babylon's editors shows a group: a node material's in the Node Material Editor, a compositor's in the Node
  // Render Graph Editor, an object, light, camera or other material in the Inspector.
  /** @param {Group} group */
  function editorOf(group) {
    const binds = allRows(group).flatMap((r) => r.controls).map((c) => bindOf(c.path)).filter(Boolean);
    const scene = blend.scene;
    const material = binds.find((b) => b?.material !== undefined)?.material, node = binds.find((b) => b?.node !== undefined)?.node;
    if (binds.some((b) => b?.compositor !== undefined) && blend.compositor) return { title: 'Node Render Graph Editor', open: () => dev().then((d) => d.editRenderGraph(/** @type {any} */ (blend.compositor), tools)) };
    if (material !== undefined) {
      const found = scene.getMaterialById(material);
      if (found?.getClassName() === 'NodeMaterial') return { title: 'Node Material Editor', open: () => dev().then((d) => d.editMaterial(/** @type {any} */ (found), tools)) };
      if (found) return { title: 'Inspector', open: () => dev().then((d) => d.inspect(scene, found, tools)) };
    }
    const target = node !== undefined && (scene.getNodeById(node) ?? scene.getLightById(node) ?? scene.getCameraById(node));
    if (target) return { title: 'Inspector', open: () => dev().then((d) => d.inspect(scene, target, tools)) };
    return null;
  }
  const dev = () => import('./dev-tools.js');

  /** @param {Group} group @returns {Row[]} */
  const allRows = (group) => [...group.rows, ...group.groups.flatMap(allRows)];

  // A collapsible header and the content it shows, made when first opened.
  /** @param {string} key @param {string} title @param {string | undefined} kind @param {boolean} opened @param {() => Node[]} content @param {(HTMLElement | null | false)[]} extras */
  function collapsible(key, title, kind, opened, content, ...extras) {
    const open = state.open[key] ?? opened;
    const head = el('div', { className: 'ghead', role: 'button', tabIndex: 0, 'aria-label': title, 'aria-expanded': String(open) },
      [el('span', { className: 'tri' }), kind !== undefined && el('span', { className: `dot ${kind}` }), el('span', { className: 'title', textContent: title }), ...extras]);
    const inner = el('div', { className: 'rows' });
    let made = false;
    const toggle = (/** @type {boolean} */ value) => {
      head.setAttribute('aria-expanded', String(value));
      inner.hidden = !value;
      if (value && !made) { made = true; inner.append(...content()); filter(); }
    };
    toggle(open);
    const flip = () => { const value = head.getAttribute('aria-expanded') !== 'true'; state.open[key] = value; save(); toggle(value); };
    head.addEventListener('click', (e) => { if (!(/** @type {Element} */ (e.target).closest('.link'))) flip(); });
    head.addEventListener('keydown', (e) => {
      if (e.target !== head) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
      if (e.key === 'ArrowRight' && head.getAttribute('aria-expanded') !== 'true') flip();
      if (e.key === 'ArrowLeft' && head.getAttribute('aria-expanded') === 'true') flip();
    });
    return [head, inner];
  }

  /** @type {{ element: HTMLElement, rows: Row[], titles: string[] }[]} */
  const filtered = [];
  /** @param {Group} group @param {string[]} titles @param {number} siblings */
  function groupElement(group, titles, siblings) {
    const editor = titles.length === 1 ? editorOf(group) : null;
    const link = editor && el('button', { type: 'button', className: 'tool link', title: editor.title, 'aria-label': `${group.title} in ${editor.title}`, innerHTML: EDITOR_ICON,
      onclick: () => editor.open() });
    const path = [...titles, group.title];
    const element = el('div', { className: 'group', 'data-key': group.key });
    const material = titles.length === 1 && group.kind === 'materials' ? allRows(group).flatMap((r) => r.controls).map((c) => bindOf(c.path)?.material).find((m) => m !== undefined) : undefined;
    const share = material !== undefined ? el('span', { className: 'share' }) : null;
    element.append(...collapsible(group.key, group.title, group.kind, siblings <= 6, () => [
      ...group.rows.flatMap((row) => { const made = rowElement(row); for (const m of made) filtered.push({ element: m, rows: [row], titles: path }); return made; }),
      ...group.groups.map((g) => groupElement(g, path, group.groups.length)),
    ], share, link));
    if (share) {
      const dot = /** @type {HTMLElement} */ (element.querySelector('.dot'));
      onScreen.push({ element, material: String(material), share, dot, base: baseColor(group), order: onScreen.length });
    }
    filtered.push({ element, rows: allRows(group), titles: path });
    return element;
  }

  // Materials by how much of the view each covers, measured a few times a second while the panel is open
  // (control-panel-coverage.js), their order held while a field is dragged or typed into; or the scene's order. Each
  // material's icon is tinted with the colour it shows on screen, else its base colour.
  /** @type {{ element: HTMLElement, material: string, share: HTMLElement, dot: HTMLElement, base?: Row, order: number }[]} */
  const onScreen = [];
  const byScreen = el('button', { type: 'button', className: 'tool link order', textContent: 'On Screen', title: "Materials by how much of the view each covers; off: the scene's order",
    'aria-pressed': String(state.byScreen !== false), onclick: () => {
      state.byScreen = byScreen.getAttribute('aria-pressed') !== 'true';
      byScreen.setAttribute('aria-pressed', String(state.byScreen));
      save();
      if (!state.byScreen) sortMaterials(new Map());
    } });
  /** @type {Promise<{ dispose(): void }> | null} */
  let coverage = null;
  /** @param {Map<string, number>} shares @param {Map<string, string>} colours */
  const measured = (shares, colours) => {
    for (const m of onScreen) m.dot.style.setProperty('--tint', colours.get(m.material) ?? (m.base ? cssOf(m.base) : null));
    sortMaterials(state.byScreen !== false ? shares : new Map());
  };
  /** @param {Map<string, number>} shares */
  const sortMaterials = (shares) => {
    for (const m of onScreen) {
      const share = shares.get(m.material) ?? 0;
      m.share.textContent = share >= 0.005 ? `${Math.round(share * 100)}%` : share > 0 ? '<1%' : '';
    }
    if (panel.querySelector('.dragging, .editing')) return;
    const sorted = [...onScreen].sort((a, b) => (shares.get(b.material) ?? 0) - (shares.get(a.material) ?? 0) || a.order - b.order);
    if (sorted.some((m, i) => m.element.parentElement?.children[i] !== m.element)) for (const m of sorted) m.element.parentElement?.append(m.element);
  };
  const measure = (/** @type {boolean} */ on) => {
    const wanted = on && onScreen.length > 0;
    if (wanted && !coverage) {
      measured(new Map(), new Map());
      coverage = import('./control-panel-coverage.js').then(({ createCoverage }) => createCoverage(blend.scene, measured));
    }
    if (!wanted && coverage) {
      coverage.then((c) => c.dispose());
      coverage = null;
    }
  };

  const empty = el('div', { className: 'empty', hidden: true });
  // The view: the camera looked through and how the viewer moves it.
  const offered = (tools.offer ?? Object.keys(MODES)).filter((m) => m !== 'JOYSTICKS' || matchMedia('(pointer: coarse)').matches);
  const cameras = blend.scene.cameras.filter((c) => c.name !== '__navigation');
  const segments = el('div', { className: 'segments', role: 'radiogroup', 'aria-label': 'Navigation' }, offered.map((mode) => el('button', {
    type: 'button', className: 'tool', role: 'radio', textContent: MODES[mode][0], title: MODES[mode][1].replace(/<[^>]+>/g, ''), 'aria-checked': String(mode === (tools.navigation ?? 'FIXED')),
    onclick: async () => {
      for (const b of Array.from(segments.children)) b.setAttribute('aria-checked', String(b.textContent === MODES[mode][0]));
      foot.innerHTML = MODES[mode][1];
      (await viewer()).navigate(/** @type {any} */ (mode));
    } })));
  const chooser = cameras.length > 1 && el('select', { 'aria-label': 'Camera', onchange: async () => {
    (await viewer()).look(/** @type {any} */ (cameras[Number(chooser && chooser.value)]));
    for (const b of Array.from(segments.children)) b.setAttribute('aria-checked', String(b.textContent === MODES.FIXED[0]));
  } }, cameras.map((c, i) => el('option', { value: String(i), textContent: c.name, selected: c === blend.scene.activeCamera })));
  const viewSection = el('div', { className: 'section' });
  if (cameras.length && offered.length > 1) {
    viewSection.append(...collapsible('section view', 'View', undefined, true, () => [
      chooser && el('div', { className: 'row' }, [el('span', { className: 'label', textContent: 'Camera' }), el('div', { className: 'value' }, [chooser])]),
      el('div', { className: 'row' }, [el('div', { className: 'value' }, [segments])]),
    ].filter((n) => !!n).map((n) => /** @type {Node} */ (n))));
    body.append(viewSection);
  }

  body.append(...sections.map((section) => {
    const element = el('div', { className: 'section' });
    element.append(...collapsible(`section ${section.key}`, section.title, undefined, true, () => section.groups.map((g) => groupElement(g, [section.title], section.groups.length)),
      section.key === 'materials' && byScreen));
    filtered.push({ element, rows: section.groups.flatMap(allRows), titles: [section.title] });
    return element;
  }), empty);

  // What shows: rows away from Blender's defaults, changed here or matching the search, or every row with Show All.
  function filter() {
    const query = search.value.trim(), showAll = all.getAttribute('aria-pressed') === 'true';
    const shown = (/** @type {Row} */ row, /** @type {string[]} */ titles) => (query ? matches(row, titles, query)
      : showAll || touched.has(row.key) || !atDefault(row, get));
    let any = false;
    for (const { element, rows, titles } of filtered) {
      const visible = rows.some((row) => shown(row, titles));
      element.hidden = !visible;
      any ||= visible;
    }
    empty.hidden = any;
    empty.textContent = query ? `Nothing matches "${query}"` : controls.length ? "Every property is at Blender's default. Show them with All." : 'This scene has no controls.';
  }
  search.addEventListener('input', filter);
  all.addEventListener('click', () => {
    const value = all.getAttribute('aria-pressed') !== 'true';
    all.setAttribute('aria-pressed', String(value));
    state.all = value;
    save();
    filter();
  });
  inspector.addEventListener('click', () => dev().then((d) => d.inspect(blend.scene, null, tools)));
  filter();

  // Values set elsewhere (the page, the animation) shown once a frame.
  const dirty = new Set();
  let frame = 0;
  const changed = blend.onChanged.add(({ path }) => {
    if (panel.hidden || !views.has(path)) return;
    dirty.add(path);
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      for (const p of dirty) for (const show of views.get(p) ?? []) show(get(p));
      dirty.clear();
    });
  });

  const toggle = (/** @type {boolean} */ open = panel.hidden) => {
    place();
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    measure(open);
    if (open) {
      for (const [path, shows] of views) for (const show of shows) show(get(path));
      filter();
      search.focus({ preventScroll: true });
    } else if (shadow.activeElement && panel.contains(shadow.activeElement)) button.focus();
  };
  close.addEventListener('click', () => toggle(false));
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (search.value && shadow.activeElement === search) { search.value = ''; filter(); } else toggle(false); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); search.focus(); search.select(); }
    if (e.key === 'ArrowDown' && shadow.activeElement === search) { e.preventDefault(); /** @type {HTMLElement | null} */ (body.querySelector('.row:not([hidden]) [tabindex="0"], .row:not([hidden]) input, .row:not([hidden]) select, .row:not([hidden]) button'))?.focus(); }
  });
  // Keys stay with the panel, not the page's camera.
  for (const type of ['keydown', 'keyup', 'wheel']) panel.addEventListener(type, (e) => e.stopPropagation());
  return { toggle, dispose: () => { measure(false); blend.onChanged.remove(changed); cancelAnimationFrame(frame); panel.remove(); } };
}
