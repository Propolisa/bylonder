import { normalizeKeys } from '../windowmanager/input/keymap.js';

// Rolls Blender's surface (tools/blender-reference/surface.py) up against what Bylonder implements
// (scripts/blender-coverage.mjs) and the hand-written notes index (docs/blender-coverage.md).
// Menus, panels, operators and key bindings count one each; areas, modes, groups and keymaps only contain them.
export const STATUS = {
  done: { label: 'Done', score: 1 },
  equivalent: { label: 'Equivalent', score: 1 },
  replaced: { label: 'Replaced', score: 1 },
  partial: { label: 'Partial', score: 0.5 },
  planned: { label: 'Planned', score: 0 },
  missing: { label: 'Missing', score: 0 },
  skip: { label: 'Not applicable', score: 0 },
};
const COUNTED = new Set(['menu', 'panel', 'op', 'key']);

// "## key" headings, then optional "Status:" and "See:" lines, then free text. A key is a path of ids or labels
// separated by " > "; the last segment names the node, earlier ones any of its ancestors, in order. A key ending
// in " > *" covers the node's whole subtree.
export function parseNotes(markdown) {
  return markdown.split(/^## /m).slice(1).map((block) => {
    const [heading, ...lines] = block.split('\n');
    const field = (name) => lines.find((l) => l.startsWith(name + ':'))?.slice(name.length + 1).trim();
    const text = lines.filter((l) => !/^(Status|See):/.test(l)).join('\n').trim();
    const subtree = /\s+>\s+\*\s*$/.test(heading);
    return { path: segments(heading.replace(/\s+>\s+\*\s*$/, '')), subtree, status: field('Status')?.toLowerCase(), see: field('See'), text };
  });
}
const segments = (key) => key.trim().split(/\s+>\s+/).map((s) => s.toLowerCase());
const names = (node) => [node.id.toLowerCase(), node.l?.toLowerCase()];

function matches(path, node, ancestors) {
  if (!names(node).includes(path.at(-1))) return false;
  let i = 0;
  for (const a of ancestors) if (i < path.length - 1 && names(a).includes(path[i])) i++;
  return i === path.length - 1;
}

export const DISPATCHED = '*';
const REGISTRY = 'registry';

// What the scene window provides from Blender's own code (window.__bylonder.coverage()) counts where it has the editor
// and mode: operators it registers, those registered for a space type only in that space's editors, and the menus and
// panels it draws from Blender's scripts.
const EDITORS = new Set(['TOPBAR', 'VIEW_3D', 'OUTLINER', 'PROPERTIES', 'TIMELINE', 'DOPESHEET', 'FCURVES', 'DRIVERS', 'ShaderNodeTree',
  'CompositorNodeTree', 'SEQUENCE_EDITOR', 'TEXT_EDITOR', 'CONSOLE', 'INFO']);
const MODES = new Set(['VIEW_3D:OBJECT', 'VIEW_3D:EDIT']);
// A space type's editors, as the surface names them (by ui_type).
const SPACE_AREAS = { DOPESHEET_EDITOR: ['TIMELINE', 'DOPESHEET'], GRAPH_EDITOR: ['FCURVES', 'DRIVERS'] };

export function runtimeAvailable({ operators = [], spaceOperators = {}, classes = [] } = {}) {
  const ui = new Set(classes), everywhere = new Set(operators), inSpaces = new Set(Object.values(spaceOperators).flat()), byArea = {};
  for (const [space, ids] of Object.entries(spaceOperators)) for (const area of SPACE_AREAS[space] ?? [space]) ids.forEach((id) => (byArea[area] ??= new Set()).add(id));
  // The Top Bar holds the keymaps editors share (Markers, View2D): a binding there runs in the editors that register
  // its operator.
  const shared = (area, ancestors, id) => area === 'TOPBAR' && ancestors.some((a) => a.k === 'keymap') && inSpaces.has(id);
  return (node, ancestors) => {
    const area = ancestors.find((a) => a.k === 'area')?.id, mode = ancestors.find((a) => a.k === 'mode')?.id;
    if (!EDITORS.has(area) || (mode && !MODES.has(mode))) return false;
    if (node.k !== 'op') return (node.k === 'menu' || node.k === 'panel') && ui.has(node.id);
    return everywhere.has(node.id) || !!byArea[area]?.has(node.id) || shared(area, ancestors, node.id);
  };
}

// `available(node, ancestors)` tells what Bylonder provides at run time from Blender's own code: operators it runs and
// menus and panels it draws from Blender's scripts, which the scan of its source cannot see.
export function computeCoverage(surface, implemented, notesMarkdown = '', available = () => false) {
  const notes = parseNotes(notesMarkdown);
  const qualified = new Map(), plain = new Set();
  for (const entry of implemented) {
    const [id, scope] = entry.split('@');
    const [name, keys] = id.split('|');
    const key = keys ? name + '|' + normalizeKeys(keys) : name;
    if (scope) (qualified.get(key) ?? qualified.set(key, new Set()).get(key)).add(scope);
    else plain.add(key);
  }
  const has = (key, ancestors) => plain.has(key) || ancestors.some((a) => qualified.get(key)?.has(a.id));
  // A binding in a keymap Bylonder dispatches from Blender's own (`*` scoped to it) counts when what it runs is there:
  // its operator registered (`@registry`, or at run time), or the menu or panel it calls (named by the binding) one
  // Bylonder's source names.
  const runs = (id, ancestors) => (/_(MT|PT)_/.test(id) ? plain.has(id) : !!qualified.get(id)?.has(REGISTRY) || available({ k: 'op', id }, ancestors));
  const dispatched = (node, ancestors) => runs(node.id, ancestors) && has(DISPATCHED, ancestors);
  const implementedNode = (node, ancestors) => (node.k === 'key'
    ? has(node.id + '|' + normalizeKeys(node.x), ancestors) || dispatched(node, ancestors)
    : has(node.id, ancestors) || available(node, ancestors));
  const all = [];

  function visit(node, ancestors, key) {
    const parentsPresent = ancestors.every((a) => !['menu', 'panel'].includes(a.k) || a.present);
    const out = { ...node, key, ancestors, present: COUNTED.has(node.k) && parentsPresent && implementedNode(node, ancestors) };
    out.note = notes.find((n) => matches(n.path, out, ancestors));
    out.inherited = out.note?.subtree ? out.note : ancestors.at(-1)?.inherited;
    out.c = node.c?.map((child, i) => visit(child, [...ancestors, out], key + '/' + i));
    all.push(out);
    return out;
  }
  const tree = surface.tree.map((area, i) => visit(area, [], String(i)));
  const resolve = (key) => all.find((n) => matches(segments(key), n, n.ancestors));
  for (const node of all) {
    node.target = node.note?.see ? resolve(node.note.see) : undefined;
    const own = node.note && !node.note.subtree ? node.note.status : undefined;
    node.status = !COUNTED.has(node.k) ? null
      : STATUS[own] ? own
      : node.present ? (node.inherited?.status === 'partial' ? 'partial' : 'done')
      : node.target?.present ? 'equivalent'
      : STATUS[node.inherited?.status] ? node.inherited.status
      : 'missing';
  }
  // Per node: counts by status over its subtree, total (skip excluded) and score.
  const roll = (node) => {
    node.counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0]));
    if (node.status) node.counts[node.status]++;
    for (const child of node.c ?? []) for (const [k, n] of Object.entries(roll(child).counts)) node.counts[k] += n;
    node.total = Object.entries(node.counts).reduce((s, [k, n]) => s + (k === 'skip' ? 0 : n), 0);
    node.score = Object.entries(node.counts).reduce((s, [k, n]) => s + STATUS[k].score * n, 0);
    return node;
  };
  const root = roll({ c: tree });
  return { blender: surface.blender, tree, counts: root.counts, total: root.total, score: root.score, unmatched: unmatchedIds(implemented, new Set(surface.ids)) };
}

// Ids in our source that Blender does not have: usually typos.
function unmatchedIds(implemented, known) {
  return [...new Set(implemented.map((e) => e.split(/[@|]/)[0]))].filter((id) => id !== DISPATCHED && !known.has(id.split(':')[0]));
}
