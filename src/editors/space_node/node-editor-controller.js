// Blender's node editor behaviour over a node tree (node-tree.js): selection (node_select.cc), moving nodes
// (transform's node translate), links (node_relationships.cc: link drag, links_cut, add_reroute, link_make), and
// node_edit.cc's mute, hide, delete, join, duplicate and view operators. The view draws what `state` holds; pointer
// input comes in as press, move and release in view pixels, keys as Blender's operators by idname (run).
import { reactive, markRaw } from 'vue';
import { nodeLayout, linkPoints, crossing, HEADER, U } from './node-layout.js';

const DRAG_THRESHOLD = 3;
const SOCKET_HIT = 10;
// A frame's margin around its nodes and its label's height (node_draw.cc, frame_node_prepare_for_draw).
export const FRAME_MARGIN = U / 2, FRAME_LABEL = U;

export function createNodeEditorController(tree, { openAddMenu = () => {}, viewport = () => ({ width: 800, height: 600 }) } = {}) {
  const state = reactive({ version: 0, view: { x: 0, y: 0, zoom: 1 }, selected: new Set(), active: null, modal: null, pointer: [0, 0] });
  let cache = { version: -1 }, press = null;
  const refresh = () => { state.version++; };
  const layouts = () => {
    if (cache.version !== state.version) cache = { version: state.version, list: tree.nodes().map((n) => markRaw(nodeLayout(n))) };
    return cache.list;
  };
  const layoutOf = (block) => layouts().find((l) => l.node.block === block);
  const sockets = () => layouts().flatMap((l) => l.sockets);
  const toWorld = ([x, y]) => [(x - state.view.x) / state.view.zoom, (y - state.view.y) / state.view.zoom];

  // Frames drawn around their nodes, Blender's shrink-to-fit frames.
  const frames = () => tree.frames().map((frame) => {
    const inside = layouts().filter((l) => frame.blocks.includes(l.node.id));
    if (!inside.length) return { frame, x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    const x0 = Math.min(...inside.map((l) => l.node.x)) - FRAME_MARGIN, y0 = Math.min(...inside.map((l) => l.node.y)) - FRAME_MARGIN - FRAME_LABEL;
    const x1 = Math.max(...inside.map((l) => l.node.x + l.width)) + FRAME_MARGIN, y1 = Math.max(...inside.map((l) => l.node.y + l.height)) + FRAME_MARGIN;
    Object.assign(frame, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    return { frame, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });

  const links = () => {
    const at = new Map(sockets().map((s) => [s.socket.point, s]));
    return tree.links().map(({ from, to }) => ({ from, to, a: at.get(from), b: at.get(to) })).filter((l) => l.a && l.b);
  };

  // Hit tests, topmost first: sockets, then nodes, then frames.
  const socketAt = (p) => sockets().find((s) => Math.hypot(s.x - p[0], s.y - p[1]) <= SOCKET_HIT / Math.min(1, state.view.zoom));
  const nodeAt = (p) => [...layouts()].reverse().find((l) => p[0] >= l.node.x - (l.node.reroute ? 6 : 0) && p[0] <= l.node.x + Math.max(l.width, 6)
    && p[1] >= l.node.y - (l.node.reroute ? 6 : 0) && p[1] <= l.node.y + Math.max(l.height, 6));
  const frameAt = (p) => frames().find((f) => p[0] >= f.x && p[0] <= f.x + f.width && p[1] >= f.y && p[1] <= f.y + f.height);

  const selectedBlocks = () => tree.blocks().filter((b) => state.selected.has(b.uniqueId));
  const select = (ids, { extend = false } = {}) => {
    if (!extend) state.selected.clear();
    ids.forEach((id) => state.selected.add(id));
    if (ids.length) state.active = ids.at(-1);
  };

  const editor = {
    state, tree, layouts, frames, links, toWorld, refresh,

    // node.select_all
    selectAll(action = 'SELECT') {
      const ids = tree.blocks().map((b) => b.uniqueId);
      if (action === 'TOGGLE') action = state.selected.size ? 'DESELECT' : 'SELECT';
      if (action === 'INVERT') ids.forEach((id) => (state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id)));
      else if (action === 'SELECT') select(ids);
      else state.selected.clear();
    },

    // node.mute_toggle, node.hide_toggle, node.hide_socket_toggle (each sets all selected from the active's state).
    toggle(kind) {
      const blocks = selectedBlocks();
      if (!blocks.length) return;
      const first = tree.node(blocks[0]);
      for (const block of blocks) {
        if (kind === 'mute') tree.setMuted(block, !first.muted);
        else if (kind === 'hide') tree.setHidden(block, !first.hidden);
        else tree.setSocketsHidden(block, !first.socketsHidden);
      }
      refresh();
    },

    // node.delete and node.delete_reconnect: the latter links what fed each removed node to what it fed.
    remove(reconnect = false) {
      const blocks = selectedBlocks();
      if (reconnect) {
        for (const block of blocks) {
          const input = block.inputs.find((i) => i.connectedPoint && !blocks.includes(i.connectedPoint.ownerBlock));
          for (const output of block.outputs) for (const to of [...output.endpoints]) if (input && !blocks.includes(to.ownerBlock)) { output.disconnectFrom(to); tree.link(input.connectedPoint, to); }
        }
      }
      tree.remove(blocks);
      state.selected.clear();
      state.active = null;
      refresh();
    },

    // node.join: a frame around the selected nodes.
    join() {
      const blocks = selectedBlocks();
      if (!blocks.length) return;
      tree.join(blocks);
      refresh();
    },

    // node.link_make: links the selected nodes' first free matching sockets, left to right.
    makeLinks() {
      const list = layouts().filter((l) => state.selected.has(l.node.id) && !l.node.reroute).sort((a, b) => a.node.x - b.node.x);
      for (let i = 0; i + 1 < list.length; i++) {
        const out = list[i].node.outputs.find((o) => list[i + 1].node.inputs.some((s) => !s.linked && tree.canLink(o.point, s.point)));
        const to = out && list[i + 1].node.inputs.find((s) => !s.linked && tree.canLink(out.point, s.point));
        if (to) tree.link(out.point, to.point);
      }
      refresh();
    },

    // node.duplicate_move: copies with the links between them and from outside, then moves them.
    duplicate() {
      const blocks = selectedBlocks();
      if (!blocks.length) return;
      const copies = tree.duplicate(blocks, U, U);
      refresh();
      select(copies.map((b) => b.uniqueId));
      editor.startMove(state.pointer, false);
    },

    // node.add_node with use_transform: the node at the pointer, moving until confirmed.
    add(name, settings = {}) {
      const [x, y] = toWorld(state.pointer);
      const block = tree.add(name, x - 70, y - HEADER / 2, settings);
      if (!block) return null;
      refresh();
      select([block.uniqueId]);
      editor.startMove(state.pointer, false);
      return block;
    },

    // node.view_all and node.view_selected: the nodes fit the region, zoom at most 1 as Blender's clamps it.
    viewAll(onlySelected = false) {
      const list = layouts().filter((l) => !onlySelected || state.selected.has(l.node.id));
      if (!list.length) return;
      const x0 = Math.min(...list.map((l) => l.node.x)), y0 = Math.min(...list.map((l) => l.node.y));
      const x1 = Math.max(...list.map((l) => l.node.x + l.width)), y1 = Math.max(...list.map((l) => l.node.y + l.height));
      const { width, height } = viewport(), pad = U * 2;
      const zoom = Math.min(1, (width - 2 * pad) / Math.max(1, x1 - x0), (height - 2 * pad) / Math.max(1, y1 - y0));
      Object.assign(state.view, { zoom, x: width / 2 - ((x0 + x1) / 2) * zoom, y: height / 2 - ((y0 + y1) / 2) * zoom });
    },

    // view2d.zoom at the pointer, within Blender's node editor limits.
    zoom(factor, at = state.pointer) {
      const zoom = Math.min(2.31, Math.max(0.09, state.view.zoom * factor)), k = zoom / state.view.zoom;
      Object.assign(state.view, { zoom, x: at[0] - (at[0] - state.view.x) * k, y: at[1] - (at[1] - state.view.y) * k });
    },
    pan(dx, dy) { state.view.x += dx; state.view.y += dy; },

    // transform.translate (G, or dragging a node): the selected nodes follow the pointer; a click or Enter confirms,
    // Escape or right click restores them. A drag confirms on release.
    startMove(at, releaseConfirm) {
      const blocks = selectedBlocks();
      if (!blocks.length) return;
      state.modal = { type: 'move', start: at, releaseConfirm, origin: markRaw(blocks.map((b) => [b, { ...tree.location(b) }])) };
    },

    // Pointer input in view pixels, with the event's buttons and modifiers (Blender's keymap for these is the
    // Node Editor's mouse items and the View2D navigation).
    pointerDown(at, e) {
      state.pointer = at;
      const modal = state.modal;
      if (modal) {
        if (modal.type === 'move') return e.button === 2 ? cancelMove() : confirmMove();
        return;
      }
      const p = toWorld(at);
      if (e.button === 1) return (press = { kind: 'pan', at });
      if (e.button === 2) return (press = { kind: e.ctrlKey ? 'cut' : e.shiftKey ? 'reroute' : 'none', at, p });
      if (e.button !== 0) return;
      const socket = socketAt(p), layout = !socket && nodeAt(p), frame = !socket && !layout && frameAt(p);
      if (socket) return (press = { kind: 'link', at, socket, ctrl: e.ctrlKey });
      if (layout || frame) {
        const ids = layout ? [layout.node.id] : frame.frame.blocks;
        const already = ids.every((id) => state.selected.has(id));
        if (e.shiftKey) {
          if (already && state.active === ids[0]) ids.forEach((id) => state.selected.delete(id)); else select(ids, { extend: true });
        } else if (!already) select(ids);
        else state.active = ids.at(-1);
        press = { kind: 'node', at, ids, passthrough: already && !e.shiftKey };
        return;
      }
      press = { kind: 'box', at, extend: e.shiftKey, subtract: e.ctrlKey };
    },

    pointerMove(at) {
      const previous = state.pointer;
      state.pointer = at;
      const modal = state.modal;
      if (modal?.type === 'move') {
        const dx = (at[0] - modal.start[0]) / state.view.zoom, dy = (at[1] - modal.start[1]) / state.view.zoom;
        for (const [block, origin] of modal.origin) tree.setLocation(block, origin.x + dx, origin.y + dy);
        return refresh();
      }
      if (modal?.type === 'link' || modal?.type === 'box') return void (modal.to = at);
      if (modal?.type === 'cut' || modal?.type === 'reroute') return void modal.path.push(toWorld(at));
      if (!press) return;
      if (press.kind === 'pan') return editor.pan(at[0] - previous[0], at[1] - previous[1]);
      if (Math.hypot(at[0] - press.at[0], at[1] - press.at[1]) < DRAG_THRESHOLD) return;
      const started = press;
      press = null;
      if (started.kind === 'node') return editor.startMove(started.at, true), editor.pointerMove(at);
      if (started.kind === 'box') state.modal = { type: 'box', from: started.at, to: at, extend: started.extend, subtract: started.subtract };
      if (started.kind === 'cut' || started.kind === 'reroute') state.modal = { type: started.kind, path: [started.p, toWorld(at)] };
      if (started.kind === 'link') startLink(started.socket, started.ctrl, at);
    },

    pointerUp(at, e) {
      state.pointer = at;
      const modal = state.modal, started = press;
      press = null;
      if (modal?.type === 'move' && modal.releaseConfirm) return confirmMove();
      if (modal?.type === 'link') return finishLink(at);
      if (modal?.type === 'box') return finishBox(modal);
      if (modal?.type === 'cut') return finishCut(modal.path);
      if (modal?.type === 'reroute') return finishReroute(modal.path);
      // A click: on a selected node selects it alone (select_passthrough); on empty space deselects all.
      if (started?.kind === 'node' && started.passthrough && !e.shiftKey) select(started.ids);
      if (started?.kind === 'box' && !started.extend) state.selected.clear(), (state.active = null);
    },

    // Keys a modal handler takes before the keymaps: Escape cancels, Enter confirms.
    modalKey(key) {
      const modal = state.modal;
      if (!modal) return false;
      if (key === 'Escape') { if (modal.type === 'move') cancelMove(); else state.modal = null; return true; }
      if (key === 'Enter' && modal.type === 'move') { confirmMove(); return true; }
      return modal.type === 'move';
    },

    // Blender's Node Editor keymap operators Bylonder runs, by idname, with the keymap item's properties.
    operators: {
      'node.select_all': ({ action }) => editor.selectAll(action),
      'node.mute_toggle': () => editor.toggle('mute'),
      'node.hide_toggle': () => editor.toggle('hide'),
      'node.hide_socket_toggle': () => editor.toggle('sockets'),
      'node.delete': () => editor.remove(false),
      'node.delete_reconnect': () => editor.remove(true),
      'node.join_nodes': () => editor.join(),
      'node.link_make': () => editor.makeLinks(),
      'node.duplicate_move': () => editor.duplicate(),
      'node.view_all': () => editor.viewAll(),
      'node.view_selected': () => editor.viewAll(true),
      'node.translate_attach': () => editor.startMove(state.pointer, false),
      'wm.call_menu': ({ name }) => name === 'NODE_MT_add' && openAddMenu(state.pointer),
    },
    run(idname, props = {}) {
      const operator = editor.operators[idname];
      if (!operator || (idname === 'wm.call_menu' && props.name !== 'NODE_MT_add')) return false;
      operator(props);
      return true;
    },
  };

  const confirmMove = () => { state.modal = null; tree.moved(); refresh(); };
  const cancelMove = () => {
    for (const [block, origin] of state.modal.origin) tree.setLocation(block, origin.x, origin.y);
    state.modal = null;
    refresh();
  };

  // Dragging from an output starts a link; from a linked input, picks the link up (detaching it) as Blender does.
  function startLink(start, ctrl, at) {
    const { point } = start.socket;
    if (start.side === 'in' && point.connectedPoint) {
      const from = point.connectedPoint;
      tree.unlink(point);
      refresh();
      const origin = sockets().find((s) => s.socket.point === from);
      state.modal = { type: 'link', from: markRaw(origin), to: at, side: 'out' };
    } else state.modal = { type: 'link', from: markRaw(start), to: at, side: start.side };
  }

  // Released over a node, the link goes to its first socket of the other side it can link to, nearest the pointer.
  function finishLink(at) {
    const { from, side } = state.modal;
    state.modal = null;
    const p = toWorld(at), target = nodeAt(p);
    if (target && target.node.block !== from.socket.point.ownerBlock) {
      const candidates = target.sockets.filter((s) => s.side !== side && (side === 'out' ? tree.canLink(from.socket.point, s.socket.point) : tree.canLink(s.socket.point, from.socket.point)));
      const best = candidates.sort((a, b) => Math.abs(a.y - p[1]) - Math.abs(b.y - p[1]))[0];
      if (best) side === 'out' ? tree.link(from.socket.point, best.socket.point) : tree.link(best.socket.point, from.socket.point);
    }
    refresh();
  }

  function finishBox({ from, to, extend, subtract }) {
    state.modal = null;
    const [x0, y0] = toWorld([Math.min(from[0], to[0]), Math.min(from[1], to[1])]), [x1, y1] = toWorld([Math.max(from[0], to[0]), Math.max(from[1], to[1])]);
    const inside = layouts().filter((l) => l.node.x < x1 && l.node.x + l.width > x0 && l.node.y < y1 && l.node.y + Math.max(l.height, 1) > y0).map((l) => l.node.id);
    if (subtract) inside.forEach((id) => state.selected.delete(id));
    else select(inside, { extend });
  }

  const segments = (path) => path.slice(1).map((p, i) => [path[i], p]);
  const crossings = (path) => links().flatMap((link) => {
    const curve = segments(linkPoints([link.a.x, link.a.y], [link.b.x, link.b.y]));
    const hit = segments(path).flatMap((s) => curve.map((c) => crossing(s, c))).find(Boolean);
    return hit ? [{ link, at: hit }] : [];
  });

  // node.links_cut: links the drawn path crosses are removed.
  function finishCut(path) {
    state.modal = null;
    for (const { link } of crossings(path)) tree.unlink(link.to);
    refresh();
  }

  // node.add_reroute: a reroute where the path crosses each link.
  function finishReroute(path) {
    state.modal = null;
    for (const { link, at } of crossings(path)) tree.insertReroute(link.from, link.to, at[0], at[1]);
    refresh();
  }

  return editor;
}
