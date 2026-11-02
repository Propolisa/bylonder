// The Python Console (SPACE_CONSOLE): Blender's own (editors/screen/blender-area.js), its scrollback and edit line
// drawn by console_draw.cc, its keys Blender's Console keymap, its operators console_ops.cc's and bl_operators/console.py's,
// which run Blender's _console_python in the module's CPython. Showing the section starts Python, and the console is
// Blender's once it has (in Blender Python runs before any console draws): its first draw prints the banner into the
// empty scrollback (console.banner).
import { mountBlenderArea } from '../screen/blender-area.js';
import { startPython, pythonRan } from '../../python/python.js';
import { report } from '../../windowmanager/wm-reports.js';

const SPACE_CONSOLE = 18;

// finished(): after a line ran (console.execute), what it changed of Main drawn.
const ran = (operators) => operators.some(({ idname }) => idname === 'CONSOLE_OT_execute');
export function mountConsole(section, { header, finished = () => {} }) {
  let area = null, disposed = false;
  const mount = () => {
    if (disposed) return;
    area = mountBlenderArea(section, { spacetype: SPACE_CONSOLE, name: 'CONSOLE', operators: 'console.', keymaps: ['Console'], header,
      finished: (operators) => { if (ran(operators)) { pythonRan(); finished(); } }, report: (error) => report('ERROR', error.message ?? String(error)) });
  };
  const shown = new ResizeObserver(() => {
    if (!section.clientWidth || !section.clientHeight) return;
    shown.disconnect();
    startPython().then(mount, (error) => report('ERROR', error.message));
  });
  shown.observe(section);
  return { refresh: () => area?.refresh(), dispose() { disposed = true; shown.disconnect(); area?.dispose(); } };
}
