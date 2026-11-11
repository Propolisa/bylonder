// A package's morph targets (shape keys) in scene.bin instead of JSON: per manager its mesh's own positions and
// normals once (the basis), and per target only the vertices it moves, with their offsets from the basis. A face's
// shape keys each move a few hundred of its thousands of vertices. The page rebuilds each target's full arrays at
// load (MORPH_KEYS_SOURCE), as Babylon's MorphTargetManager.Parse reads them.
import { VertexBuffer } from '@babylonjs/core';

// What a vertex must move by to count as moved: a hundredth of a millimeter, a ten-thousandth of a normal.
const MOVED = { positions: 1e-5, normals: 1e-4 };

/** The vertices `target` moves away from `basis`, by MOVED, as indices into it. */
function moved(target, basis, size, bound) {
  const out = [];
  for (let v = 0; v < basis.length / size; v++) {
    for (let k = 0; k < size; k++) if (Math.abs(target[v * size + k] - basis[v * size + k]) > bound) { out.push(v); break; }
  }
  return out;
}

/**
 * The morph target managers (`managers`, serialized) to write, their arrays moved into `bin`; `meshes`, the scene's
 * meshes, give each manager's basis (the mesh using it). A manager whose mesh is not found is written as it is.
 */
export function binaryMorphTargets(managers, meshes, bin) {
  return managers.map((manager) => {
    const mesh = meshes.find((m) => m.morphTargetManager && String(m.morphTargetManager.uniqueId) === String(manager.id));
    const basis = mesh && { positions: mesh.getVerticesData(VertexBuffer.PositionKind, false, true), normals: mesh.getVerticesData(VertexBuffer.NormalKind, false, true) };
    if (!basis?.positions || manager.targets.some((t) => t.positions?.length !== basis.positions.length)) return manager;
    const kinds = ['positions', ...(basis.normals && manager.targets.every((t) => t.normals?.length === basis.normals.length) ? ['normals'] : [])];
    return { ...manager, bylonderBasis: Object.fromEntries(kinds.map((kind) => [kind, bin.add(Float32Array.from(basis[kind]))])),
      targets: manager.targets.map(({ positions, normals, ...target }) => {
        const arrays = { positions, normals }, vertices = [...new Set(kinds.flatMap((kind) => moved(arrays[kind], basis[kind], 3, MOVED[kind])))].sort((a, b) => a - b);
        const offsets = (kind) => Float32Array.from(vertices.flatMap((v) => [0, 1, 2].map((k) => arrays[kind][v * 3 + k] - basis[kind][v * 3 + k])));
        return { ...target, bylonderSparse: { vertices: bin.add(Uint32Array.from(vertices)), ...Object.fromEntries(kinds.map((kind) => [kind, bin.add(offsets(kind))])) } };
      }) };
  });
}

/** The page's code that rebuilds a manager's targets from scene.bin (`buffers`) before Babylon parses it. */
export const MORPH_KEYS_SOURCE = `// A morph target manager's targets from scene.bin: its basis, and each target's moved vertices' offsets
// (io_scene_babylon/morph-export.js).
function morphKeys(entry, buffers) {
  if (!entry.bylonderBasis) return entry;
  const targets = entry.targets.map(({ bylonderSparse: sparse, ...target }) => {
    const vertices = buffers[sparse.vertices], full = {};
    for (const [kind, index] of Object.entries(entry.bylonderBasis)) {
      const array = Float32Array.from(buffers[index]), offsets = buffers[sparse[kind]];
      vertices.forEach((v, i) => { for (let k = 0; k < 3; k++) array[v * 3 + k] += offsets[i * 3 + k]; });
      full[kind] = array;
    }
    return { ...target, ...full };
  });
  return { ...entry, targets };
}
`;
