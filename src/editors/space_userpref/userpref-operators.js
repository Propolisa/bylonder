// The Preferences' operators that reach outside Blender's window: opening the editor (screen.userpref_show, as
// Blender opens it in a new window, or maximized in an area per Preferences > Interface > Editors > Preferences) and
// activating a key configuration preset (preferences.keyconfig_activate, as bpy.utils.keyconfig_set loads one).
import { createApp, h } from 'vue';
import { blenderMain } from '../../bmesh/bmesh-wasm.js';
import { registerOperators } from '../../windowmanager/wm-operators.js';
import { keyconfigSet } from '../../windowmanager/wm-window.js';
import { preferences, preferencesChanged } from '../../windowmanager/wm-userdef.js';
import PreferencesWindow from './PreferencesWindow.vue';

let opened = null;
function openWindow() {
  if (opened) return;
  const host = document.body.appendChild(document.createElement('div'));
  const app = createApp({ render: () => h(PreferencesWindow, { onClose: close }) });
  const close = () => { app.unmount(); host.remove(); opened = null; };
  app.mount(host);
  opened = { close };
}

//   showArea(): shows the Preferences editor maximized in the app's area.
export function registerUserprefOperators({ showArea }) {
  registerOperators({
    'screen.userpref_show': {
      run: ({ section } = {}) => {
        if (section) preferences().active_section = section;
        if (preferences().view.preferences_display_type === 'SCREEN') showArea();
        else openWindow();
      },
    },
    'preferences.keyconfig_activate': {
      run: ({ filepath }) => {
        const name = filepath.split('/').pop().replace(/\.py$/, '');
        if (!keyconfigSet(blenderMain().C, name)) return 'CANCELLED';
        preferencesChanged();
      },
    },
  });
}
