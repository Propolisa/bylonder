// The Info editor (SPACE_INFO): Blender's own (editors/screen/blender-area.js), listing the window manager's reports
// (windowmanager/wm-reports.js) as info_draw.cc draws them, with Blender's info operators and Info keymap.
import { mountBlenderArea } from '../screen/blender-area.js';
import { subscribeReports } from '../../windowmanager/wm-reports.js';

const SPACE_INFO = 7;

export function mountInfo(section, { header }) {
  const area = mountBlenderArea(section, { spacetype: SPACE_INFO, name: 'INFO', operators: 'info.', keymaps: ['Info'], header });
  const unsubscribe = subscribeReports(() => area.refresh());
  return { ...area, dispose() { unsubscribe(); area.dispose(); } };
}
