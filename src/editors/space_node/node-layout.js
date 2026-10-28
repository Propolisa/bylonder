// Where node_draw.cc puts a node's parts, in view units (a 20 pixel UI unit at zoom 1): the header, then output
// sockets, buttons and input sockets in rows, each socket on the node's edge at its row's middle. A collapsed node is
// its header, its sockets at its middle; a reroute is a point.
export const U = 20;
export const HEADER = U, ROW = 22, SOCKET_RADIUS = 5;
const TOP = 4, BOTTOM = 6, VECTOR_ROWS = 4;

// Blender's node classes (color_tag) as the theme colors of their headers (theme.css --bl-node-*).
const TAGS = {
  CONVERTER: 'converter', COLOR: 'color', INPUT: 'input', OUTPUT: 'output', SHADER: 'shader', TEXTURE: 'texture', VECTOR: 'vector',
  FILTER: 'filter', DISTORT: 'distort', MATTE: 'matte', GROUP: 'group', INTERFACE: 'interface', GEOMETRY: 'geometry', ATTRIBUTE: 'attribute', SCRIPT: 'script',
};
export const headerColor = (tag) => `var(--bl-node-${TAGS[tag] ?? 'converter'})`;
export const socketColor = (type) => `var(--bl-socket-${type.toLowerCase().replace(/_/g, '-')})`;

export const socketKey = (side, point) => `${side}:${point.ownerBlock?.uniqueId}:${point.name}`;

const rowHeight = (socket) => (socket.value && !socket.linked && socket.type === 'VECTOR' ? ROW * VECTOR_ROWS : ROW);

export function nodeLayout(node) {
  const sockets = [];
  if (node.reroute) {
    for (const [side, list] of [['in', node.inputs], ['out', node.outputs]]) {
      for (const s of list) sockets.push({ key: socketKey(side, s.point), side, socket: s, x: node.x, y: node.y });
    }
    return { node, rows: [], width: 0, height: 0, sockets };
  }
  const rows = [];
  let y = HEADER + TOP;
  const add = (kind, item, h = ROW) => { rows.push({ kind, item, y, h }); y += h; };
  node.outputs.forEach((s) => add('output', s));
  node.outputs.filter((s) => s.value).forEach((s) => add('value', s, rowHeight({ ...s, linked: false })));
  node.buttons.forEach((b) => add('button', b));
  node.inputs.forEach((s) => add('input', s, rowHeight(s)));
  const height = node.hidden ? HEADER : y + BOTTOM;
  for (const row of rows) {
    if (row.kind !== 'output' && row.kind !== 'input') continue;
    const side = row.kind === 'output' ? 'out' : 'in';
    sockets.push({
      key: socketKey(side, row.item.point), side, socket: row.item,
      x: node.x + (side === 'out' ? node.width : 0), y: node.y + (node.hidden ? HEADER / 2 : row.y + ROW / 2),
    });
  }
  return { node, rows: node.hidden ? [] : rows, width: node.width, height, sockets };
}

// node_link_bezier_points: handles leave each socket horizontally, shortened for links close to horizontal.
function bezier([x0, y0], [x3, y3], curving = 4) {
  const dx = Math.abs(x0 - x3), dy = Math.abs(y0 - y3);
  const handle = curving * 0.1 * dx * Math.min(1, (dx ? dy / dx : 0) * (4.5 - 0.25 * curving));
  return [[x0, y0], [x0 + handle, y0], [x3 - handle, y3], [x3, y3]];
}

export const linkPath = (from, to) => {
  const [a, b, c, d] = bezier(from, to);
  return `M${a} C${b} ${c} ${d}`;
};

// The link sampled, for hit tests (links_cut, add_reroute).
export function linkPoints(from, to, steps = 24) {
  const p = bezier(from, to);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [0, 1].map((k) => w.reduce((sum, wi, j) => sum + wi * p[j][k], 0));
  });
}

// Where two segments cross, if they do.
export function crossing([a, b], [c, d]) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (!den) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}
