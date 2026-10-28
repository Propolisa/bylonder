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
import { inArea } from '../../windowmanager/wm-operators.js';


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

  // This editor as the context area: its operators and its menus (Shift A's wm.call_menu opens its Add menu).
  const area = { nodeEditor: editor, menu: (name) => (name === 'NODE_MT_add' ? () => editor.operators['wm.call_menu']({ name }) : null) };
  const keys = keymapHandler(['Node Editor', 'Node Generic', 'View2D', 'Frames', 'Screen', 'Window']);
  const onKey = (e) => {
    if (e.target.closest('input,textarea,select') || e.repeat) return;
    const event = { type: keyType(e), value: 'PRESS', shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey, native: e };
    const handled = editor.modalKey(e.key) || inArea(area, () => keys(event));
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
