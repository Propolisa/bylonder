// The Spreadsheet (SPACE_SPREADSHEET): Blender's own (editors/screen/blender-area.js), showing the active object's
// original or evaluated geometry, or a Viewer node's, as space_spreadsheet.cc does: its data set region's panels
// (the context and the tree of components and domains), the table drawn by spreadsheet_draw.cc, and the row count in
// its footer, with Blender's spreadsheet operators and keymaps. Each evaluation of Main tags it for a redraw.
import { mountBlenderArea } from '../screen/blender-area.js';
import { RGN_TYPE_TOOLS } from '../../windowmanager/wm-window.js';

const SPACE_SPREADSHEET = 23;
// The data set region's width (space_spreadsheet.cc: 150 pixels and a scroll bar), in widget units.
const DATA_SET_UNITS = 8;

export function mountSpreadsheet(section, { header, sync }) {
  const area = mountBlenderArea(section, { spacetype: SPACE_SPREADSHEET, name: 'SPREADSHEET', operators: 'spreadsheet.', keymaps: ['Spreadsheet Generic'], header,
    footer: 'draw', left: { type: RGN_TYPE_TOOLS, units: DATA_SET_UNITS } });
  const unsubscribe = sync.onEvaluated(() => area.tagRedraw());
  return { ...area, dispose() { unsubscribe(); area.dispose(); } };
}
