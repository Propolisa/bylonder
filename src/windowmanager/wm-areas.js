// The page's editors that are Blender's own areas (editors/screen/blender-area.js), as Blender's window sees them: it
// takes the input over them, each laid out from its elements first, and they redraw the regions Blender tagged. What
// Blender leaves unhandled goes to the page's keymaps with the area's own first (areaKeys).
import { Window, configureWindow } from './wm-window.js';
import { blenderMain } from '../bmesh/bmesh-wasm.js';
import './wm-clipboard.js';

const hosts = new Set();
let window = null, active = null;

// host: { element, area, layout(), redraw(regions), finished(operators), keys(event) }.
export function registerArea(host) {
  hosts.add(host);
  return () => { hosts.delete(host); if (active === host) active = null; };
}
export const blenderWindow = () => (window ??= new Window(blenderMain()));

const hostOf = (native) => [...hosts].find((host) => host.element.contains(native.target));
export const takes = (native) => !!hostOf(native);

export function send(native, kind, data, strings) {
  const w = blenderWindow();
  configureWindow(w);
  active = hostOf(native);
  w.size = { width: innerWidth, height: innerHeight };
  for (const host of hosts) host.layout();
  const result = w.event(kind, data, strings);
  for (const host of hosts) {
    const regions = result.redraw.filter(([area]) => area === host.area.pointer).map(([, region]) => region);
    if (regions.length || (host === active && result.finished.length)) host.redraw(regions);
    if (host === active && result.finished.length) host.finished(result.finished);
  }
  return result;
}
// The keymaps of the area an event Blender's window left unhandled came from.
export const areaKeys = (event) => !!(active?.element.contains(event.native?.target) && active.keys(event));
