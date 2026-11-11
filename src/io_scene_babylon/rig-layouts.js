// The DNA layouts of a rig's settings by RNA name (dna-constraints.json), as Blender's constraint kernels
// (polyfill/constraints.js) write them: apart from rig-export.js, which reads Main, so the module's check loads them alone.
import dna from '../makesrna/dna-constraints.json' with { type: 'json' };

// What the kernels are not given: names and targets they are given otherwise, what Blender computes from the rest
// (a pose bone's matrices), and what only the interface reads.
const SKIP = {
  Constraint: ['name', 'type', 'is_override_data', 'space_subtarget', 'show_expanded', 'is_valid', 'active', 'error_location', 'error_rotation'],
  Bone: ['name', 'hide', 'hide_select', 'show_wire', 'display_type'],
  PoseBone: ['name', 'matrix', 'matrix_channel', 'head', 'tail', 'hide', 'select'],
  ConstraintTarget: [], ConstraintTargetBone: [],
};
const SETTING_KINDS = new Set(['int', 'float']);

// A property's layout as writeValues and readValues take it: an enum's items by identifier.
const layoutOf = ({ type, items, custom, struct, ...field }) => ({ ...field, boolean: type === 'BOOLEAN',
  ...(items?.length && { items: Object.fromEntries(items.map(([value, id]) => [id, value])) }) });

// The fields a struct's RNA properties name, its own and, for Constraint, those its types name in it (head_tail).
const fieldsOf = (struct) => {
  const sdna = dna[struct]?.sdna, own = Object.entries(dna[struct]?.properties ?? {}).filter(([, p]) => !p.struct);
  const named = Object.values(dna).flatMap((s) => Object.entries(s.properties)).filter(([, p]) => p.struct && p.struct === sdna);
  return [...own, ...named];
};

/** The layouts of a struct's settings: numbers, flags, enums and names, but pointers. @param {string} struct */
export function layoutsOf(struct) {
  const skip = new Set(SKIP[struct] ?? []);
  return Object.fromEntries(fieldsOf(struct)
    .filter(([name, p]) => !skip.has(name) && SETTING_KINDS.has(p.kind) && (p.type !== 'STRING' || struct.startsWith('ConstraintTarget')))
    .map(([name, p]) => [name, layoutOf(p)]));
}
