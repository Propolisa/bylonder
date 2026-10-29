// The regions of box, lasso and circle select (view3d_select.cc), for the modes that select in the page.

// eSelectOp: SET replaces, ADD extends (Shift), SUB subtracts (Ctrl), AND intersects, XOR toggles.
export const SEL_OP_ADD = 1, SEL_OP_SUB = 2, SEL_OP_SET = 3, SEL_OP_AND = 4, SEL_OP_XOR = 5;
export const SEL_OPS = { ADD: SEL_OP_ADD, SUB: SEL_OP_SUB, SET: SEL_OP_SET, AND: SEL_OP_AND, XOR: SEL_OP_XOR };

const segmentsCross = (p, q, s, t) => {
  const d = (q[0] - p[0]) * (t[1] - s[1]) - (q[1] - p[1]) * (t[0] - s[0]);
  if (!d) return false;
  const u = ((s[0] - p[0]) * (t[1] - s[1]) - (s[1] - p[1]) * (t[0] - s[0])) / d, v = ((s[0] - p[0]) * (q[1] - p[1]) - (s[1] - p[1]) * (q[0] - p[0])) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
};
const insidePolygon = (polygon, [x, y]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const crossesPolygon = (polygon, a, b) => polygon.some((p, i) => segmentsCross(a, b, p, polygon[(i + 1) % polygon.length]));

// The regions: whether a point is inside, and whether an edge crosses it (box and lasso: edges fully inside first).
export const boxRegion = (r) => {
  const corners = [[r.xmin, r.ymin], [r.xmax, r.ymin], [r.xmax, r.ymax], [r.xmin, r.ymax]];
  const point = (p) => p[0] >= r.xmin && p[0] <= r.xmax && p[1] >= r.ymin && p[1] <= r.ymax;
  return { point, edge: (a, b) => point(a) || point(b) || crossesPolygon(corners, a, b), edgesInsideFirst: true };
};
// BLI_lasso_is_point_inside, BLI_lasso_is_edge_inside.
export const lassoRegion = (path) => {
  const point = (p) => insidePolygon(path, p);
  return { point, edge: (a, b) => point(a) || point(b) || crossesPolygon(path, a, b), edgesInsideFirst: true };
};
// edge_inside_circle: an edge within the radius of the center.
export const circleRegion = ([cx, cy], radius) => {
  const point = ([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  const edge = ([ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / length)) : 0;
    return point([ax + t * dx, ay + t * dy]);
  };
  return { point, edge, edgesInsideFirst: false, circle: true };
};
