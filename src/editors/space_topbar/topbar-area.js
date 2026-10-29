// The Top Bar's menus (space_topbar.py's TOPBAR_MT_editor_menus) laid out by Blender in a Top Bar area of the scene
// window, where Main is, for the app page's topbar (workspace/topbar.js), which draws them as block-view.js's menus with
// this area's `ui`.
// The app page's own operators and menu entries come in through host(): its operators Blender and the scene lack
// become the scene's (and so Blender's operator types), and its draw functions are Menu.append's.
import { markRaw } from 'vue';
import { AnimArea, RGN_TYPE_HEADER } from '../animation/anim-area.js';
import { menuTree } from '../interface/ui-tree.js';
import { treeMenu } from '../interface/block-view.js';
import { invokeOperator, registerOperator, runsOperator, appendMenu, prependMenu } from '../../windowmanager/wm-operators.js';
import { blenderKeys } from '../../windowmanager/keyconfig.js';

const SPACE_TOPBAR = 21;
// HEADERY: a header region's height in pixels at 1x scale.
const HEADER_HEIGHT = 26;

//   main: the scene's BlenderMain; sync: its Main sync (main-sync.js), made current before Blender reads it.
export function createTopbarArea(main, sync) {
  const area = new AnimArea(main, SPACE_TOPBAR);
  const ui = markRaw({
    inContext: (fn) => {
      sync?.flush();
      area.layout(RGN_TYPE_HEADER, 0, 0, innerWidth, HEADER_HEIGHT);
      return area.inContext(RGN_TYPE_HEADER, fn);
    },
    refresh: () => sync?.view(),
    undoPush: () => sync?.view(),
    report: (error) => console.warn(error),
    run: (idname, props, event) => { invokeOperator(idname, props, event); sync?.view(); },
    keys: (idname, props) => blenderKeys(['Window', 'Screen'], idname, props),
  });
  const menu = (name) => ui.inContext((C) => menuTree(C, name));
  const buttons = (node) => (node.kind === 'button' ? [node] : (node.children ?? []).flatMap(buttons));
  return {
    ui,
    // The app page's operators ({ idname: { run, poll, keys } }), draw functions ([idname, 'append' or 'prepend', draw]) and
    // application templates (File > New's, bpy.utils.app_template_paths), by name.
    host(operators, extensions, templates) {
      for (const [idname, operator] of Object.entries(operators)) if (!runsOperator(idname)) registerOperator(idname, operator);
      for (const [idname, side, draw] of extensions) (side === 'prepend' ? prependMenu : appendMenu)(idname, draw);
      globalThis.__py_modules['os.path']._mount('/blender/scripts/startup/bl_app_templates_system', templates);
    },
    // The menus of the bar: { label, menu } for each.
    bar: () => buttons(menu('TOPBAR_MT_editor_menus') ?? {}).filter((b) => b.menu).map((b) => ({ label: b.text, menu: b.menu })),
    // A menu's tree (ui-tree.js), or null without the menu.
    menu,
    // A menu's entries for menu.js, built here: their sub-menus are laid out by this window's module.
    items: (name) => treeMenu(menu(name) ?? { children: [] }, ui),
  };
}
