// The 3D Views as areas of Blender's window (windowmanager/wm-window.js): their window regions are their canvases, their
// views Babylon's cameras, and in Object Mode their input runs Blender's keymaps and modal operators on Main, which the
// scene sync keeps equal to the scene: flushed before Blender's code runs, viewed after, with the selected meshes'
// geometry given to it while an operator runs, an undo step when one finishes, and the popups it opens drawn by the
// page. What Blender leaves unhandled goes to the page's keymaps (wm-event-system.js).
import { Window, configureWindow, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../../windowmanager/wm-window.js';
import { regionView3D } from './view3d-project.js';
import { openModulePopup, runBlenderOperator } from '../object/object-operators.js';
import { tagRedraw } from '../../draw/overlay-tool.js';

// The popups an invoke opens (operator_popup's numbers).
const POPUPS = [null, 'CONFIRM', 'ENUM_MENU', 'PROPS', 'LAYOUT'];
const pageRect = (rect) => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });

//   sync: the scene's (createMainSync); views(): the 3D Views; takes(): whether Blender's window takes input now (Object
//   Mode); host: runBlenderOperator's options (transaction, notify, keying, commit, wm, pointer, view), menu(name, event)
//   opening a menu of the page.
export function createView3DWindow({ sync, views, takes, host, menu }) {
  const window = new Window(sync.blender);
  const areas = new Map();
  let running = false;

  function area(view) {
    if (!areas.has(view)) areas.set(view, window.area(SPACE_VIEW3D));
    const a = areas.get(view), rect = pageRect(view.canvas.getBoundingClientRect());
    a.layout(rect, { [RGN_TYPE_WINDOW]: rect });
    a.view3d = regionView3D(view);
    return a;
  }

  function popup({ menu: name, type, title, text, idname, values }, event) {
    if (name) return menu(name, event);
    if (POPUPS[type] === 'PROPS') return;
    const finish = (chosen) => chosen && runBlenderOperator(sync, idname, { ...values, ...(chosen === true ? {} : chosen) }, { ...host, event: null });
    openModulePopup(sync, { type: POPUPS[type], title, text }, event, { idname, finish });
  }

  function send(kind, data, strings, view) {
    configureWindow(window);
    window.size = { width: innerWidth, height: innerHeight };
    for (const v of views()) area(v);
    const acting = kind !== 'pointermove' || running;
    // An operator may start: Main gets the scene, and the selected meshes' geometry while it runs.
    if (acting && !running) sync.begin({ meshes: sync.selected() });
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
    return result;
  }

  return {
    takes: (native, view) => running || (takes() && !!view && native.pointerType !== 'touch'),
    send,
    pressHandled: () => window.pressHandled(),
  };
}
