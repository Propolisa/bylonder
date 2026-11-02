// The page's editors that are Blender's own areas (editors/screen/blender-area.js), as Blender's window sees them: it
// takes the input over them, each laid out from its elements first, and they redraw the regions Blender tagged. What
// Blender leaves unhandled goes to the page's keymaps with the area's own first (areaKeys).
import { Window, configureWindow } from './wm-window.js';
import { blenderMain } from '../bmesh/bmesh-wasm.js';
import './wm-clipboard.js';

const hosts = new Set(), watchers = new Set();
let window = null, active = null;

// host: { element, area, layout(), redraw(regions), finished(operators), keys(event), takes?(native): whether Blender's
// window takes an event over the element (by default every one) }.
export function registerArea(host) {
  hosts.add(host);
  return () => { hosts.delete(host); if (active === host) active = null; };
}
// fn(redraw) after each event and tick of the window, with the regions Blender tagged ([area, regiontype] pairs), for
// regions of areas that are not Blender's editors (a 3D View's asset shelf).
export function watchRedraws(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
export const blenderWindow = () => (window ??= new Window(blenderMain()));

const hostOf = (native) => [...hosts].find((host) => host.element.contains(native.target) && (host.takes?.(native) ?? true));
export const takes = (native) => !!hostOf(native);

export function send(native, kind, data, strings) {
  const w = blenderWindow();
  configureWindow(w);
  active = hostOf(native);
  w.size = { width: innerWidth, height: innerHeight };
  for (const host of hosts) host.layout();
  return deliver(w.event(kind, data, strings));
}
function deliver(result) {
  for (const host of hosts) {
    const regions = result.redraw.filter(([area]) => area === host.area.pointer).map(([, region]) => region);
    if (regions.length || (host === active && result.finished.length)) host.redraw(regions);
    if (host === active && result.finished.length) host.finished(result.finished);
  }
  for (const fn of watchers) fn(result.redraw);
  ticking();
  return result;
}

// The window's queued events, timers and notifiers handled now (an event added outside the page's input: a file
// dialog's choice, wm-fileselect.js).
export const tick = () => deliver(blenderWindow().tick());
// The window's timers (panel animations, operators' timers, jobs) and notifiers run each animation frame while it has any.
let frame = 0;
export function ticking() {
  if (frame || !blenderWindow().pending || typeof requestAnimationFrame === 'undefined') return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    deliver(blenderWindow().tick());
  });
}
// The keymaps of the area an event Blender's window left unhandled came from.
export const areaKeys = (event) => !!(active?.element.contains(event.native?.target) && active.keys(event));
