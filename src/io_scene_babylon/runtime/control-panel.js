// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A page's control panel: a button at a corner of the canvas, the top right one or the one by the side the panel is
// docked to, shown when the pointer comes near the corner, a finger taps there or the keyboard reaches it, that opens
// the panel (control-panel-ui.js), loaded on first open. What the viewer arranged is kept per page.

/**
 * Where the editors the panel links to load from: Babylon's CDN, or the package's `bylonder-dev-tools/`.
 * How the viewer moves the view (control-panel-camera.js): the mode the page starts in, and those the panel offers.
 * @typedef {object} PanelOptions
 * @property {'CDN' | 'PACKAGE'} [tools]
 * @property {string} [root] the package's URL
 * @property {import('./control-panel-camera.js').Navigation} [navigation]
 * @property {import('./control-panel-camera.js').Navigation[]} [offer]
 */

/**
 * What the viewer arranged, kept per page; the panel's size in its own pixels.
 * @typedef {{ open: Record<string, boolean>, all?: boolean, scale?: number, byScreen?: boolean, dock?: Dock, width?: number, height?: number }} PanelState
 * @typedef {'left' | 'right' | 'top' | 'bottom'} Dock
 */

// How near the corner, in pixels, the pointer shows the button, and how long a tap there keeps it shown.
const NEAR = 96, TAP_SHOWS = 4000;

// Bylonder's theme (src/theme.css) at a UI scale of 1, which the panel draws with; a test keeps the copy current.
export const TOKENS = `--bl-font-family:"Inter","DejaVu Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
--bl-text:#e6e6e6;--bl-text-dim:#a6a6a6;--bl-text-off:#7a7a7a;--bl-link:#71a8ff;--bl-select:#4772b3;--bl-hover:#ffffff14;--bl-header:#303030;
--bl-panel-back:#3d3d3d;--bl-panel-sub-back:#0000001f;--bl-panel-outline:#ffffff11;--bl-panel-title:#e6e6e6;--bl-region:#303030;
--bl-wcol-outline:#3d3d3d;--bl-wcol-emboss:#00000026;--bl-wcol-hover:#ffffff17;--bl-wcol-num:#545454;--bl-wcol-num-sel:#222222;--bl-wcol-num-item:#4772b3;
--bl-wcol-option:#545454;--bl-wcol-option-sel:#4772b3;--bl-wcol-option-item:#ffffff;--bl-wcol-text:#1d1d1d;--bl-wcol-text-cursor:#71a8ff;--bl-wcol-menu:#282828;--bl-wcol-menu-item:#d9d9d9;
--bl-shadow-menu:0 3px 6px #0003;--bl-shadow-popup:0 10px 40px #000a;--bl-tooltip:#1d1d1d;--bl-tooltip-text:#d9d9d9;--bl-split-label:40%;
--bl-icon-object:#e19658;--bl-icon-object-data:#00d4a3;--bl-icon-modifier:#74a2ff;--bl-icon-shading:#cc6670;--bl-icon-scene:#cccccc;
--cp-font-size:11px;--cp-row:20px;--cp-radius:4px;--cp-gap:2px`;

const STYLE = `:host{all:initial;${TOKENS};position:fixed;z-index:2147483000;top:0;left:0;width:0;height:0}
.toggle{position:fixed;top:var(--top);right:var(--right);display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:var(--cp-radius);
  background:var(--bl-header);color:var(--bl-text);box-shadow:inset 0 0 0 1px var(--bl-panel-outline),var(--bl-shadow-menu);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .15s}
:host([data-dock=left]) .toggle{right:auto;left:var(--left)}:host([data-dock=bottom]) .toggle{top:auto;bottom:var(--bottom)}
.toggle:hover{background:var(--bl-panel-back)}.toggle svg{width:16px;height:16px}
.toggle.near,.toggle:focus-visible,.toggle[aria-expanded=true]{opacity:1;pointer-events:auto}
.toggle:focus-visible{outline:1px solid var(--bl-select);outline-offset:1px}
.toggle[aria-expanded=true]{background:var(--bl-select);color:var(--bl-wcol-option-item)}
@media (prefers-reduced-motion:reduce){.toggle{transition:none}}`;
// Three sliders: Bylonder's own drawing.
const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="10" cy="4" r="1.6" fill="currentColor"/><circle cx="5" cy="8" r="1.6" fill="currentColor"/><circle cx="11" cy="12" r="1.6" fill="currentColor"/></svg>';

/**
 * Adds the control panel of a loaded scene to the page; it goes with the scene.
 * @param {import('./blend-scene.js').BlendScene} blend
 * @param {PanelOptions} [options]
 */
export function controlPanel(blend, options = {}) {
  const canvas = blend.scene.getEngine().getRenderingCanvas();
  if (!canvas || typeof document === 'undefined') return null;
  const host = document.body.appendChild(document.createElement('div'));
  host.dataset.bylonder = 'control-panel';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLE}</style><button class="toggle" type="button" aria-label="Controls" title="Controls" aria-expanded="false">${ICON}</button>`;
  const button = /** @type {HTMLButtonElement} */ (shadow.querySelector('.toggle'));
  const storageKey = `bylonder-control-panel:${location.pathname}`;
  /** @type {PanelState} */
  const state = (() => { try { return { open: {}, ...JSON.parse(localStorage.getItem(storageKey) ?? '{}') }; } catch { return { open: {} }; } })();
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* storage may be off */ } };
  host.dataset.dock = state.dock ?? 'right';

  // The canvas's visible edges, inset, as the panel and its button are placed by them.
  const place = () => {
    const rect = canvas.getBoundingClientRect(), width = document.documentElement.clientWidth;
    const top = Math.max(rect.top, 0) + 8, bottom = Math.min(rect.bottom, innerHeight) - 8;
    const left = Math.max(rect.left, 0) + 8, right = Math.min(rect.right, width) - 8;
    const edges = { top, bottom: innerHeight - bottom, left, right: width - right, height: Math.max(bottom - top, 120), width: Math.max(right - left, 160) };
    for (const [name, value] of Object.entries(edges)) host.style.setProperty(`--${name}`, `${value}px`);
    return rect;
  };
  place();
  // Near the button, wherever the panel's side put it.
  const near = (/** @type {PointerEvent} */ e) => {
    const { x, y, width, height } = button.getBoundingClientRect();
    return Math.abs(e.clientX - x - width / 2) < NEAR && Math.abs(e.clientY - y - height / 2) < NEAR;
  };
  // A tap that shows the button does not also press it.
  let tapped = 0, shownAt = 0;
  const moved = (/** @type {PointerEvent} */ e) => {
    if (e.pointerType === 'mouse') button.classList.toggle('near', near(e));
  };
  const down = (/** @type {PointerEvent} */ e) => {
    if (e.pointerType === 'mouse' || !near(e)) return;
    if (!button.classList.contains('near') && button.getAttribute('aria-expanded') !== 'true') shownAt = performance.now();
    button.classList.add('near');
    clearTimeout(tapped);
    tapped = Number(setTimeout(() => button.classList.remove('near'), TAP_SHOWS));
  };
  const observer = new ResizeObserver(place);
  observer.observe(canvas);
  addEventListener('pointermove', moved, { passive: true });
  addEventListener('pointerdown', down, { passive: true, capture: true });
  addEventListener('resize', place);
  addEventListener('scroll', place, { passive: true, capture: true });

  /** @type {Promise<ReturnType<import('./control-panel-camera.js').createNavigation>> | null} */
  let navigating = null;
  const navigation = () => (navigating ??= import('./control-panel-camera.js').then(({ createNavigation }) => createNavigation(blend.scene)));
  if (options.navigation && options.navigation !== 'FIXED') navigation().then((n) => n.navigate(/** @type {any} */ (options.navigation)));
  /** @type {Promise<{ toggle(open?: boolean): void, dispose(): void }> | null} */
  let panel = null;
  const open = () => (panel ??= import('./control-panel-ui.js').then(({ createPanel }) => createPanel(shadow, blend, { ...options, button, place, viewer: navigation, state, save })));
  button.addEventListener('click', async () => {
    if (performance.now() - shownAt > 350) (await open()).toggle();
  });

  const dispose = async () => {
    observer.disconnect();
    removeEventListener('pointermove', moved);
    removeEventListener('pointerdown', down, { capture: true });
    removeEventListener('resize', place);
    removeEventListener('scroll', place, { capture: true });
    (await panel)?.dispose();
    (await navigating)?.dispose();
    host.remove();
  };
  blend.scene.onDisposeObservable.addOnce(dispose);
  return { open: async () => (await open()).toggle(true), close: async () => (await panel)?.toggle(false), dispose };
}
