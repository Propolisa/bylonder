// Writes src/io_scene_babylon/panel-icons.js: the Blender icons an exported page's control panel draws (its Collections
// view and its timeline), as a package ships them in bylonder-icons/ (GPL, runtime-files.js gplFiles).
//   usage: node scripts/panel-icons.mjs
import { writeFileSync } from 'node:fs';
import { blenderIcons } from './blender-icons.mjs';
import sizes from '../src/editors/interface/icon-sizes.json' with { type: 'json' };

export const PANEL_ICONS = ['outliner_collection', 'hide_off', 'hide_on', 'restrict_render_off', 'restrict_render_on', 'checkbox_hlt', 'checkbox_dehlt', 'play', 'pause'];

const icons = await blenderIcons('public/icons/blender');
const entries = PANEL_ICONS.map((name) => `  ${name}: ${JSON.stringify([icons[name], ...(sizes[name] ?? [1600, 1600])])},`);
writeFileSync('src/io_scene_babylon/panel-icons.js', `// SPDX-License-Identifier: GPL-3.0-or-later
// Blender's icons the control panel draws, by name: [SVG, width, height], the icon a 1600-unit square of its document
// (public/icons/blender, written by scripts/panel-icons.mjs).
export default {
${entries.join('\n')}
};
`);
