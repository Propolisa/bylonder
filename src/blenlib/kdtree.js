// KD-tree over 3D points (BLI_kdtree.hh of Blender 5.2), in single precision like Blender's. The balanced node
// order decides which duplicates cluster together, so it is ported as is.
const f32 = Math.fround;
const UNSET = -1;

const distance_squared = (a, b) => {
  const dx = f32(a[0] - b[0]), dy = f32(a[1] - b[1]), dz = f32(a[2] - b[2]);
  return f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz));
};

// kdtree_balance: quick-select around the median on each axis in turn; returns the subtree root's node index.
function balance(nodes, from, len, axis) {
  if (len <= 0) return UNSET;
  if (len === 1) return from;
  const node = (i) => nodes[from + i], swap = (i, j) => { const t = nodes[from + i]; nodes[from + i] = nodes[from + j]; nodes[from + j] = t; };
  let left = 0, right = len - 1;
  const median = len >> 1;
  while (right > left) {
    const co = node(right).co[axis];
    let i = left - 1, j = right;
    for (;;) {
      while (node(++i).co[axis] < co);
      while (node(--j).co[axis] > co && j > left);
      if (i >= j) break;
      swap(i, j);
    }
    swap(i, right);
    if (i >= median) right = i - 1;
    if (i <= median) left = i + 1;
  }
  const m = node(median);
  m.d = axis;
  axis = (axis + 1) % 3;
  m.left = balance(nodes, from, median, axis);
  m.right = balance(nodes, from + median + 1, len - (median + 1), axis);
  return from + median;
}

// kdtree_new, kdtree_insert for each point, then kdtree_balance.
export function kdtree_build(positions) {
  const nodes = positions.map((co, index) => ({ co: co.map(f32), index, d: 0, left: UNSET, right: UNSET }));
  return { nodes, root: balance(nodes, 0, nodes.length, 0) };
}

// kdtree_range_search_cb: fn(index, dist_sq) for every point within `range` of `co`, in tree order.
export function kdtree_range_search_cb(tree, co, range, fn) {
  if (tree.root === UNSET) return;
  range = f32(range);
  const range_sq = f32(range * range), stack = [tree.root];
  while (stack.length) {
    const node = tree.nodes[stack.pop()], c = co[node.d], n = node.co[node.d];
    if (f32(c + range) < n) { if (node.left !== UNSET) stack.push(node.left); }
    else if (f32(c - range) > n) { if (node.right !== UNSET) stack.push(node.right); }
    else {
      const dist_sq = distance_squared(node.co, co);
      if (dist_sq <= range_sq && fn(node.index, dist_sq) === false) break;
      if (node.left !== UNSET) stack.push(node.left);
      if (node.right !== UNSET) stack.push(node.right);
    }
  }
}

// kdtree_calc_duplicates_cb: fills `duplicates` (-1 for none, its own index to keep) with each point's target;
// `target(cluster)` picks the index in a cluster to keep. Returns how many points were found.
export function kdtree_calc_duplicates_cb(tree, range, duplicates, has_self_index, target) {
  if (tree.root === UNSET) return 0;
  const coOf = new Map(tree.nodes.map((node) => [node.index, node.co]));
  let found = 0;
  if (has_self_index) {
    const best_sq = new Map();
    for (const { index } of tree.nodes) {
      if (duplicates[index] !== index) continue;
      kdtree_range_search_cb(tree, coOf.get(index), range, (neighbor, dist_sq) => {
        const target_index = duplicates[neighbor];
        if (target_index === -1) {
          duplicates[neighbor] = index;
          best_sq.set(neighbor, dist_sq);
          found++;
        } else if (target_index !== neighbor && (dist_sq < best_sq.get(neighbor) || (dist_sq === best_sq.get(neighbor) && index < target_index))) {
          best_sq.set(neighbor, dist_sq);
          duplicates[neighbor] = index;
        }
      });
    }
  }
  for (const { index } of tree.nodes) {
    if (duplicates[index] !== -1) continue;
    const cluster = [];
    kdtree_range_search_cb(tree, coOf.get(index), range, (neighbor) => { if (duplicates[neighbor] === -1) cluster.push(neighbor); });
    if (!cluster.length) continue;
    found += cluster.length;
    cluster.push(index);
    const target_index = cluster[target(cluster)];
    for (const i of cluster) duplicates[i] = target_index;
  }
  return found;
}
