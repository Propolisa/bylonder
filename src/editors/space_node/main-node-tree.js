// A node tree of Main's (a Geometry Nodes modifier's node group, the scene's compositing node group) as Blender's node
// editor sees it, read and edited through Blender's RNA (bpy_rna.js): its nodes are blocks, its links links, its frames
// frames, as createNodeTree gives a Babylon graph's. Blender holds the tree and evaluates it; every edit is Blender's own API (nodes.new, links.new,
// default_value), then `changed(rebuild)`.
import { blenderMain, blenderModule } from '../../bmesh/bmesh-wasm.js';
import { pointerOf, pointerStruct, structFind } from '../../python/bpy_rna.js';
import { nodeButtonsTree } from '../interface/ui-tree.js';
import { declaration } from '../../nodes/blender/declarations.js';
import { AnimArea, RGN_TYPE_WINDOW } from '../animation/anim-area.js';

// Blender's node-editor y grows upward; the editor's downward.
const Y = -1;
const VALUES = new Set(['VALUE', 'INT', 'BOOLEAN', 'VECTOR', 'RGBA', 'MENU']);
const idOf = (struct) => pointerOf(struct)[2];
// The same data as a struct read before: an undo may have put other data at its address.
const same = (a, b) => !!a && pointerOf(a)[0] === pointerOf(b)[0] && pointerOf(a)[2] === pointerOf(b)[2];
const SPACE_NODE = 16;

// A Node Editor area of the module's showing the tree, where Blender's node operators and menus run, and its space.
function nodeArea(rnaTree) {
  const area = new AnimArea(blenderMain(), SPACE_NODE);
  area.layout(RGN_TYPE_WINDOW, 0, 0, 800, 600);
  const space = pointerStruct(structFind('SpaceNodeEditor'), 0, blenderModule.exports.anim_area_space(area.pointer) >>> 0);
  space.tree_type = rnaTree.bl_idname;
  space.node_tree = rnaTree;
  return { area, space };
}

// The tree shown is the area's edit tree (SpaceNode.edit_tree): the group its path entered (node.group_edit), else
// rootTree itself.
export function createMainNodeTree(rootTree, { changed = () => {}, kind = 'geometry' } = {}) {
  const blocks = new Map(), points = new Map();
  const point = (socket, block, output) => {
    const id = idOf(socket);
    if (!same(points.get(id)?.socket, socket)) {
      points.set(id, {
        socket, ownerBlock: block, output, name: socket.identifier,
        get connectedPoint() { const link = !output && [...edited().links].find((l) => idOf(l.to_socket) === id); return link ? pointOf(link.from_socket, link.from_node, true) : null; },
        get endpoints() { return output ? [...edited().links].filter((l) => idOf(l.from_socket) === id).map((l) => pointOf(l.to_socket, l.to_node, false)) : []; },
        disconnectFrom(to) { unlinkBetween(this, to); },
      });
    }
    return points.get(id);
  };
  const blockOf = (node) => {
    const id = idOf(node);
    if (!same(blocks.get(id)?.rna, node)) {
      const block = { uniqueId: id, rna: node };
      Object.defineProperties(block, {
        inputs: { get: () => [...node.inputs].map((s) => point(s, block, false)) },
        outputs: { get: () => [...node.outputs].map((s) => point(s, block, true)) },
      });
      blocks.set(id, block);
    }
    return blocks.get(id);
  };
  const pointOf = (socket, node, output) => point(socket, blockOf(node), output);
  const unlinkBetween = (from, to) => {
    for (const link of [...edited().links]) if (idOf(link.from_socket) === idOf(from.socket) && idOf(link.to_socket) === idOf(to.socket)) edited().links.remove(link);
  };
  let editor;
  const editorArea = () => (editor ??= nodeArea(rootTree));
  const inEditor = (fn) => editorArea().area.inContext(RGN_TYPE_WINDOW, fn);
  const edited = () => (editor ? editor.space.edit_tree : null) ?? rootTree;
  const nodesOf = () => [...edited().nodes];
  const isFrame = (node) => node.bl_idname === 'NodeFrame';
  // Blender's node operator on the nodes and frames, selected as its selection; returns the nodes selected after it.
  const operate = (idname, list, props) => {
    const ids = new Set(list.map((b) => b.uniqueId ?? idOf(b.rna)));
    for (const n of nodesOf()) n.select = ids.has(idOf(n));
    // The operators that act on one node (node.group_edit) take the active one, the last selected.
    if (list.length) edited().nodes.active = list.at(-1).rna;
    inEditor(() => blenderMain().run(idname, props));
    changed(true);
    return nodesOf().filter((n) => n.select && !isFrame(n)).map(blockOf);
  };

  // A socket as the node draws it: Blender's type, shape and label, and its value while unlinked.
  const socket = (s, block, output) => {
    const p = point(s, block, output);
    const value = !output && !s.is_linked && !s.hide_value && VALUES.has(s.type) ? {
      socket: { type: s.type, subtype: prop(s)?.subtype, name: s.name, items: s.type === 'MENU' ? menuItems(s) : undefined, min: prop(s)?.soft_min, max: prop(s)?.soft_max, size: s.type === 'VECTOR' ? prop(s)?.array_length : undefined },
      get: () => (typeof s.default_value === 'object' ? [...s.default_value] : s.default_value),
      // A menu's item changes which sockets the node shows.
      set: (v) => { s.default_value = v; changed(s.type === 'MENU'); },
    } : null;
    return { point: p, id: s.identifier, type: s.type, shape: s.display_shape, label: s.label || s.name, linked: s.is_linked, value };
  };
  // The compositor's nodes leave out the inputs their menus do not use (Blender's socket usage, is_inactive), as the
  // compositor's Babylon graph draws them.
  const shown = (s) => s.enabled && !s.hide && !(kind === 'compositor' && s.is_inactive && !s.is_linked);
  const prop = (s) => s.bl_rna.properties.get('default_value');
  // A menu's items: RNA's when static, else the node's declaration (Blender's menu sockets list them per node).
  const menuItems = (s) => {
    const items = [...prop(s).enum_items].map((item) => item.identifier);
    return items.length ? items : declaration(kind, s.node.bl_idname)?.inputs.find((d) => d.identifier === s.identifier)?.items ?? [];
  };
  // The node's properties its draw_buttons lays out, in its order, edited through RNA: a checkbox with its text, a menu
  // (whose text is its item) without.
  const buttons = (node) => {
    const drawn = new Map(), visit = (item) => {
      const prop = item.rna?.pointer[2] === idOf(node) && node.bl_rna.properties.get(item.rna.prop);
      if (prop && (prop.type === 'ENUM' || prop.type === 'BOOLEAN') && !drawn.has(prop.identifier)) drawn.set(prop.identifier, { prop, label: prop.type === 'BOOLEAN' ? item.text ?? '' : '' });
      item.children?.forEach(visit);
    };
    visit(inEditor((C) => nodeButtonsTree(C, idOf(edited()), idOf(node))) ?? {});
    return [...drawn.values()].map(({ prop, label }) => ({
      key: prop.identifier, label, type: prop.type, items: prop.type === 'ENUM' ? [...prop.enum_items].map((i) => [i.identifier, i.name, i.description]) : undefined,
      get: () => node[prop.identifier], set: (v) => { node[prop.identifier] = v; changed(true); },
    }));
  };
  const label = (node) => node.label || (node.bl_idname === 'GeometryNodeGroup' ? node.node_tree?.name : null) || node.bl_label || node.name;
  const at = (node) => { const [x, y] = node.location_absolute; return { x, y: Y * y }; };

  function node(block) {
    const n = block.rna, { x, y } = at(n);
    if (n.bl_idname === 'NodeReroute') return { id: block.uniqueId, block, reroute: true, x, y, inputs: [...n.inputs].map((s) => socket(s, block, false)), outputs: [...n.outputs].map((s) => socket(s, block, true)) };
    return {
      id: block.uniqueId, block, blender: n.bl_idname, label: label(n), tag: n.color_tag, x, y, width: n.width,
      hidden: n.hide, muted: n.mute,
      outputs: [...n.outputs].filter(shown).map((s) => socket(s, block, true)),
      inputs: [...n.inputs].filter(shown).map((s) => socket(s, block, false)),
      buttons: buttons(n), ramp: null,
    };
  }

  const tree = {
    get area() { return editorArea().area; },
    operate,
    kind, get graph() { return edited(); }, catalog: { categories: {} }, blenderClasses: {},
    // Every node type Blender has: its code runs them all.
    runs: () => true,
    blocks: () => nodesOf().filter((n) => !isFrame(n)).map(blockOf),
    byId: (id) => tree.blocks().find((b) => b.uniqueId === id),
    node,
    links: () => [...edited().links].filter((l) => !l.is_hidden).map((l) => ({ from: pointOf(l.from_socket, l.from_node, true), to: pointOf(l.to_socket, l.to_node, false) })),
    nodes: () => tree.blocks().map(node),
    // Frames with the nodes they hold, sized by the editor to them.
    frames: () => nodesOf().filter(isFrame).map((frame) => {
      const { x, y } = at(frame);
      return { rna: frame, name: frame.label || frame.name, x, y, width: frame.width, height: frame.height, blocks: nodesOf().filter((n) => n.parent && idOf(n.parent) === idOf(frame)).map(idOf) };
    }),
    location: (block) => at(block.rna),
    setLocation(block, x, y) { block.rna.location_absolute = [x, Y * y]; },
    moved: () => changed(false),
    canLink: (from, to) => from.output && !to.output && from.ownerBlock !== to.ownerBlock,
    // node.link: Blender replaces the link a single input had, and a link to a Group Input's or Output's empty socket
    // adds the group input or output it stands for (handle_dynamic_sockets).
    link(from, to) {
      if (!tree.canLink(from, to) || !edited().links.new(from.socket, to.socket, true, true)) return false;
      changed(true);
      return true;
    },
    unlink(to) { for (const link of [...edited().links]) if (idOf(link.to_socket) === idOf(to.socket)) edited().links.remove(link); changed(true); },
    // node.add_node: a node of the type, with the settings its Add menu entry gives.
    add(name, x, y, settings = {}) {
      const n = edited().nodes.new(name);
      n.location_absolute = [x, Y * y];
      for (const [key, value] of Object.entries(settings)) {
        const input = /^inputs\["(.+)"\]\.default_value$/.exec(key);
        if (input) n.inputs.get(input[1]).default_value = value; else n[key] = value;
      }
      changed(true);
      return blockOf(n);
    },
    // node.duplicate, moved by (dx, dy).
    duplicate(list, dx, dy) {
      const copies = operate('node.duplicate', list);
      for (const block of copies) { const { x, y } = at(block.rna); tree.setLocation(block, x + dx, y + dy); }
      return copies;
    },
    // node.add_reroute: a reroute on the link, at (x, y).
    insertReroute(from, to, x, y) {
      const reroute = edited().nodes.new('NodeReroute');
      reroute.location_absolute = [x, Y * y];
      unlinkBetween(from, to);
      edited().links.new(from.socket, reroute.inputs[0]);
      edited().links.new(reroute.outputs[0], to.socket);
      changed(true);
      return blockOf(reroute);
    },
    // The collapse button: node.hide_toggle on its node.
    setHidden(block) { operate('node.hide_toggle', [block]); },
  };
  return tree;
}
