// Blender's theme (Preferences > Themes) as the interface's design tokens (src/theme.css): each token that stands for
// a theme color takes that color from the Preferences' active theme, so a theme preset or an edited color restyles the
// app. Theme colors no token stands for are greyed in the Themes section (THEMED).
const WIDGET = (wcol, part) => ['user_interface', wcol, part];
// Token: the theme color's path from Theme.
export const TOKENS = {
  '--bl-topbar': ['topbar', 'space', 'header'],
  '--bl-header': ['properties', 'space', 'header'],
  '--bl-region': ['properties', 'space', 'back'],
  '--bl-viewport': ['view_3d', 'space', 'gradients', 'high_gradient'],
  '--bl-text': ['properties', 'space', 'text'],
  '--bl-axis-x': ['user_interface', 'axis_x'],
  '--bl-axis-y': ['user_interface', 'axis_y'],
  '--bl-axis-z': ['user_interface', 'axis_z'],
  '--bl-widget': WIDGET('wcol_regular', 'inner'),
  '--bl-select': WIDGET('wcol_menu_item', 'inner_sel'),
  '--bl-wcol-outline': WIDGET('wcol_regular', 'outline'),
  '--bl-wcol-num': WIDGET('wcol_num', 'inner'), '--bl-wcol-num-sel': WIDGET('wcol_num', 'inner_sel'), '--bl-wcol-num-item': WIDGET('wcol_numslider', 'item'),
  '--bl-wcol-option': WIDGET('wcol_option', 'inner'), '--bl-wcol-option-sel': WIDGET('wcol_option', 'inner_sel'), '--bl-wcol-option-item': WIDGET('wcol_option', 'item'),
  '--bl-wcol-toggle': WIDGET('wcol_toggle', 'inner'), '--bl-wcol-toggle-sel': WIDGET('wcol_toggle', 'inner_sel'),
  '--bl-wcol-tool': WIDGET('wcol_tool', 'inner'), '--bl-wcol-tool-sel': WIDGET('wcol_tool', 'inner_sel'),
  '--bl-wcol-menu': WIDGET('wcol_menu', 'inner'),
  '--bl-wcol-text': WIDGET('wcol_text', 'inner'), '--bl-wcol-text-sel': WIDGET('wcol_text', 'inner_sel'), '--bl-wcol-text-item': WIDGET('wcol_text', 'item'),
  '--bl-wcol-box': WIDGET('wcol_box', 'inner'),
  '--bl-wcol-list-sel': WIDGET('wcol_list_item', 'inner_sel'), '--bl-wcol-list-item': WIDGET('wcol_list_item', 'item'),
  '--bl-wcol-tab': WIDGET('wcol_tab', 'inner'), '--bl-wcol-tab-sel': WIDGET('wcol_tab', 'inner_sel'), '--bl-wcol-tab-text': WIDGET('wcol_tab', 'text'),
  '--bl-menu-back': WIDGET('wcol_menu_back', 'inner'), '--bl-menu-back-line': WIDGET('wcol_menu_back', 'outline'), '--bl-menu-back-text': WIDGET('wcol_menu_back', 'text'),
  '--bl-menu-item-text': WIDGET('wcol_menu_item', 'text'), '--bl-menu-item-text-sel': WIDGET('wcol_menu_item', 'text_sel'),
  '--bl-pulldown-text': WIDGET('wcol_pulldown', 'text'),
  '--bl-toolbar-item': WIDGET('wcol_toolbar_item', 'inner'), '--bl-toolbar-item-sel': WIDGET('wcol_toolbar_item', 'inner_sel'),
  '--bl-toolbar-item-text': WIDGET('wcol_toolbar_item', 'text'),
  '--bl-tooltip': WIDGET('wcol_tooltip', 'inner'),
};
// The theme structs' properties a token stands for, by struct: { ThemeWidgetColors: Set('inner', ...) }.
export const THEMED = {};

// A color as CSS, without its alpha where opaque; a header's alpha is its region overlap's, which tokens leave out.
const hex = (value, opaque) => '#' + Array.from(value, (c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
  .slice(0, opaque ? 3 : 4).join('').replace(/^(#?.{6})ff$/, '$1');
const resolve = (theme, path) => path.reduce((struct, name) => struct?.[name], theme);

// The active theme's colors on the tokens of each document given.
export function applyTheme(theme, documents) {
  for (const [token, path] of Object.entries(TOKENS)) {
    const owner = resolve(theme, path.slice(0, -1)), value = owner?.[path.at(-1)];
    if (!value) continue;
    (THEMED[owner.bl_rna.identifier] ??= new Set()).add(path.at(-1));
    for (const doc of documents) doc.documentElement.style.setProperty(token, hex(value, path.at(-1) === 'header'));
  }
}
