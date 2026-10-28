// Bylonder's Node Editor, Blender's (see docs/node-editors.md), on a Babylon graph: a NodeMaterial or NodeRenderGraph
// holding Babylon's blocks and Blender's nodes. Keys run Blender's Node Editor keymaps, then View2D, Frames, Screen
// and Window. `changed(rebuild)` follows every edit: rebuild when the graph's code or links changed.
import { createApp, h } from 'vue';
import '../interface/components/tailwind.css';
import NodeEditor from './NodeEditor.vue';
import { createNodeTree } from './node-tree.js';
import { createNodeEditorController } from './node-editor-controller.js';
import { addMenuEntries, addMenuItems } from './node-add-menu.js';
import { openMenu, searchMenu } from '../interface/menu.js';
import { keymapHandler } from '../../windowmanager/keyconfig.js';
import { keyType } from '../../windowmanager/input/keymap.js';
import { registerOperators } from '../../windowmanager/wm-operators.js';

// Blender's Node Editor operators Bylonder runs, on the Node Editor a key went to (`active` while its keymaps run).
let active = null;
const on = (idname) => ({ poll: () => !!active, run: (props) => active.run(idname, props) });
registerOperators({
  'node.select_all': on('node.select_all'),
  'node.mute_toggle': on('node.mute_toggle'),
  'node.hide_toggle': on('node.hide_toggle'),
  'node.hide_socket_toggle': on('node.hide_socket_toggle'),
  'node.delete': on('node.delete'),
  'node.delete_reconnect': on('node.delete_reconnect'),
  'node.join_nodes': on('node.join_nodes'),
  'node.link_make': on('node.link_make'),
  'node.duplicate_move': on('node.duplicate_move'),
  'node.view_all': on('node.view_all'),
  'node.view_selected': on('node.view_selected'),
  'node.translate_attach': on('node.translate_attach'),
});

export function mountBlenderNodeEditor(host, graph, { changed = () => {} } = {}) {
  const tree = createNodeTree(graph, { changed: (rebuild) => changed(rebuild) });
  const screen = (at) => {
    const r = host.getBoundingClientRect();
    return { x: r.left + at[0], y: r.top + at[1] };
  };
  const editor = createNodeEditorController(tree, {
    viewport: () => ({ width: host.clientWidth, height: host.clientHeight }),
    openAddMenu: (at) => openMenu(addMenuItems(editor), screen(at), 'Add', { search: () => addMenuEntries(editor) }),
  });
  // WM_OT_search_single_menu: the Add menu, searching from the start.
  editor.openAddSearch = () => {
    editor.operators['wm.call_menu']({ name: 'NODE_MT_add' });
    searchMenu('');
  };

  // Shift A's wm.call_menu opens this editor's Add menu; registered, it would claim every editor's menus.
  const menus = keymapHandler(['Node Editor'], undefined, (idname, props) => idname === 'wm.call_menu' && editor.run(idname, props));
  const keys = keymapHandler(['Node Editor', 'Node Generic', 'View2D', 'Frames', 'Screen', 'Window']);
  const onKey = (e) => {
    if (e.target.closest('input,textarea,select') || e.repeat) return;
    active = editor;
    let handled;
    try {
      const event = { type: keyType(e), value: 'PRESS', shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey, native: e };
      handled = editor.modalKey(e.key) || menus(event) || keys(event);
    } finally {
      active = null;
    }
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    editor.refresh();
  };

  const app = createApp({ render: () => h(NodeEditor, { editor, onKey }) });
  app.mount(host);
  if (import.meta.env?.DEV) host.nodeEditor = editor;
  // Undo and Babylon's own editor rebuild the graph: redraw from it.
  const built = graph.onBuildObservable.add(() => editor.refresh());
  // The view frames the nodes once the region has a size; resized, it keeps its center, as View2D does.
  let size = [0, 0];
  const resized = new ResizeObserver(() => {
    const next = [host.clientWidth, host.clientHeight];
    if (!next[0] || !next[1]) return;
    if (!size[0]) editor.viewAll(); else editor.pan((next[0] - size[0]) / 2, (next[1] - size[1]) / 2);
    size = next;
  });
  resized.observe(host);
  return {
    editor,
    frameAll: () => editor.viewAll(),
    dispose() {
      graph.onBuildObservable.remove(built);
      resized.disconnect();
      app.unmount();
    },
  };
}
