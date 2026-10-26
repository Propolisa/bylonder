// Operator execution (bmesh_operators.cc). Each operator gets its own layer of tool flags, pushed on entry and
// popped on exit, so a nested operator never sees or clears its caller's flags.
const POOLS = ['v', 'e', 'f'];

export function BMO_op_callf(bm, exec, ...args) {
  const saved = POOLS.map((name) => bm[name].oflag);
  for (const name of POOLS) bm[name].oflag = new Uint16Array(bm[name].oflag.length);
  try {
    return exec(bm, ...args);
  } finally {
    POOLS.forEach((name, i) => {
      // The pool may have grown during the operator; the caller's layer grows with it.
      const layer = new Uint16Array(bm[name].oflag.length);
      layer.set(saved[i]);
      bm[name].oflag = layer;
    });
  }
}
