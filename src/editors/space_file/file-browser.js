// Blender's File Browser (editors/space_file) for an operator that browses inside a .blend (File > Link, File >
// Append): Blender's own area (editors/screen/blender-area.js) in a window over the scene, as Blender opens its
// "Blender File View" window (wm_handler_fileselect_do). Its regions are space_file.cc's: the bookmarks, the directory
// path and filter bar, the list file_draw.cc draws, the operator's options and the file name with the execute
// buttons, run by Blender's file operators and keymaps. Executing or cancelling the operator closes it; closing it
// cancels the operator (ED_fileselect_exit).
import { createApp, h } from 'vue';
import { blenderMain, blenderModule } from '../../bmesh/bmesh-wasm.js';
import { mountBlenderArea } from '../screen/blender-area.js';
import { tick, watchRedraws } from '../../windowmanager/wm-areas.js';
import { RGN_TYPE_TOOLS, RGN_TYPE_TOOL_PROPS, RGN_TYPE_UI, RGN_TYPE_EXECUTE } from '../../windowmanager/wm-window.js';
import FileBrowserWindow from './FileBrowserWindow.vue';
import '../interface/components/tailwind.css';

export const SPACE_FILE = 5;
const { exports: x } = blenderModule;
// The side regions 240 pixels wide (space_file.cc), in widget units.
const SIDES = [{ type: RGN_TYPE_TOOLS, edge: 'left', units: 12 }, { type: RGN_TYPE_TOOL_PROPS, edge: 'right', units: 12 },
  { type: RGN_TYPE_UI, edge: 'top' }, { type: RGN_TYPE_EXECUTE, edge: 'bottom' }];

// Resolves once the File Browser for `op` closed, the operator run or cancelled.
export function browseFiles(op) {
  const C = blenderMain().C, element = document.body.appendChild(document.createElement('div'));
  return new Promise((resolve) => {
    let unwatch = () => {}, closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      unwatch();
      app.unmount();
      element.remove();
      tick();
      resolve();
    };
    const mount = (section) => {
      const area = mountBlenderArea(section, { spacetype: SPACE_FILE, name: 'FILE_BROWSER', operators: 'file.', keymaps: ['File Browser', 'File Browser Main', 'File Browser Buttons'],
        header: false, sides: SIDES, window: true, init: ({ pointer }) => x.fileselect_area_set(pointer, op) });
      unwatch = watchRedraws(() => { if (!x.fileselect_held(C, op)) queueMicrotask(close); });
      return area;
    };
    const app = createApp({ render: () => h(FileBrowserWindow, { title: 'Blender File View', mount, onClose: close }) });
    app.mount(element);
  });
}
