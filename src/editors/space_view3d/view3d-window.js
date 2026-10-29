// The 3D Views as areas of Blender's window (windowmanager/wm-window.js): their window regions are their canvases, their
// views Babylon's cameras, and in Object Mode their input runs Blender's keymaps and modal operators on Main, which the
// scene sync keeps equal to the scene: flushed before Blender's code runs, viewed after, with the selected meshes'
// geometry given to it while an operator runs, an undo step when one finishes, and the popups it opens drawn by the
// page. What Blender leaves unhandled goes to the page's keymaps (wm-event-system.js).
import { Window, configureWindow, allowOperators, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../../windowmanager/wm-window.js';
import { hasOperator } from '../../windowmanager/wm-operators.js';
import { operatorNames } from '../../bmesh/bmesh-wasm.js';
import { regionView3D } from './view3d-project.js';
import { openModulePopup, runBlenderOperator } from '../object/object-operators.js';
import { tagRedraw } from '../../draw/overlay-tool.js';
import { ticking } from '../../windowmanager/wm-areas.js';

// The popups an invoke opens (operator_popup's numbers).
const POPUPS = [null, 'CONFIRM', 'ENUM_MENU', 'PROPS', 'LAYOUT'];
const pageRect = (rect) => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });

//   sync: the scene's (createMainSync); views(): the 3D Views; takes(): whether Blender's window takes input now (Object
//   Mode); host: runBlenderOperator's options (transaction, notify, keying, commit, wm, pointer, view), menu(name, event)
//   opening a menu of the page; before(): what the page finishes before an operator runs (a pending Add).
export function createView3DWindow({ sync, views, takes, host, menu, before = () => {} }) {
  const window = new Window(sync.blender);
  const areas = new Map();
  let running = false;

  // A view's area, laid out from the page (unless `layout` is false: as it last was).
  function area(view, layout = true) {
    configureWindow(window);
    // Mesh Edit Mode is Blender's on Main: its operators the page has no code of its own for are Blender's (the Knife).
    allowOperators(window, operatorNames().filter((idname) => idname.startsWith('mesh.') && !hasOperator(idname)));
    if (!areas.has(view)) areas.set(view, window.area(SPACE_VIEW3D));
    else if (!layout) return areas.get(view);
    window.size = { width: innerWidth, height: innerHeight };
    const a = areas.get(view), rect = pageRect(view.canvas.getBoundingClientRect());
    a.layout(rect, { [RGN_TYPE_WINDOW]: rect, ...view.regions?.rects() });
    a.view3d = regionView3D(view);
    return a;
  }

  function popup({ menu: name, type, title, text, idname, values }, event) {
    if (name) return menu(name, event);
    if (POPUPS[type] === 'PROPS') return;
    // The values it was invoked with, but rna_type, which is no value to set.
    const set = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));
    const finish = (chosen) => chosen && runBlenderOperator(sync, idname, { ...set, ...(chosen === true ? {} : chosen) }, { ...host, event: null });
    openModulePopup(sync, { type: POPUPS[type], title, text }, event, { idname, finish });
  }

  function send(kind, data, strings, view) {
    for (const v of views()) area(v);
    const acting = kind !== 'pointermove' || running;
    // An operator may start: Main gets the scene, and the selected meshes' geometry while it runs.
    if (acting && !running) {
      before();
      sync.begin({ meshes: sync.selected() });
    }
    let result;
    host.keying(() => { result = window.event(kind, data, strings); });
    if (!acting) return result;
    running = result.modal;
    if (running) sync.view();
    else sync.end();
    if (running) host.notify(areas.get(view)?.status ?? '');
    else if (result.finished.length) host.notify('');
    if (result.finished.some(({ undo }) => undo)) host.commit();
    if (result.popup) popup(result.popup, host.pointer());
    tagRedraw();
    ticking();
    return result;
  }

  return {
    takes: (native, view) => running || (takes() && !!view && native.pointerType !== 'touch'),
    send,
    // A view's area, laid out from its elements (its header, tool header and sidebar are view.regions').
    area,
    pressHandled: () => window.pressHandled(),
  };
}
