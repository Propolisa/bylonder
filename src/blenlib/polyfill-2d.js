// Shims for blenlib/polyfill-2d.js: export a Blender name here to replace its generated port.
import { CONVEX, KDNODE_UNSET } from './polyfill-2d.gen.js';

export * from './polyfill-2d.gen.js';

// port-override: Blender reads pf->indices as the buffer it starts; here it is the first element, so the buffer is
// walked by `next`, its order before any coordinate is removed.
export function kdtree2d_init(tree, coords_num, indices) {
  let node = 0;
  for (let i = 0, pi = indices; i < coords_num; i++, pi = pi.next) {
    if (pi.sign !== CONVEX) Object.assign(tree.nodes[node++], { neg: KDNODE_UNSET, pos: KDNODE_UNSET, index: pi.index, axis: 0, flag: 0 });
  }
}
