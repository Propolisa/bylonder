// Live Modifiers in a package: an object whose modifiers are all Blender's mesh modifiers keeps its stack live. Each
// setting is a control by its RNA path (`objects["Cube"].modifiers["Solidify"].thickness`), which the scene's
// animation sets through a channel of its node (runtime/blend-scene.js); the stack is one `modifiers` operation on the
// object's base Mesh, written to scene.bin, run in the page by modifiers.wasm (runtime/modifiers-evaluator.js) when a
// setting changes. Until then the page draws the applied geometry.
import { idStruct, pointerOf } from '../python/bpy_rna.js';
import { knob, key } from './controls-export.js';

// Whether an object's modifiers read another ID (an Array's offset object, a Displace's texture), which the page's
// polyfill, given the mesh alone, lacks: such a stack stays applied.
export const readsOtherIDs = (world, node) => [...idStruct(world.mainSync.objectOf(node)).modifiers].some((modifier) =>
  [...modifier.bl_rna.properties].some(({ type, identifier }) => {
    const pointer = type === 'POINTER' && pointerOf(modifier[identifier]);
    return pointer && pointer[1] === pointer[2];
  }));

// The channel an animated setting of the stack's `index`th modifier lands in (blend-scene.js Binding.channel).
export const channelKey = (index, path) => `${index}:${path}`;

// An object's channels, with their values: its node's metadata.bylonderChannels.
export const channels = ({ modifiers }) => Object.fromEntries(modifiers.flatMap(({ values }, i) => Object.entries(values).map(([path, value]) => [channelKey(i, path), value])));

// The base Mesh's arrays as scene.bin buffers, by the names the module takes them by.
function baseBuffers(mesh, bin) {
  const uvs = mesh.attribute('UVMap');
  return {
    vert_positions: bin.add(Float32Array.from(mesh.vert_positions)), edges: bin.add(Int32Array.from(mesh.edges)), face_offsets: bin.add(Int32Array.from(mesh.face_offsets)),
    corner_verts: bin.add(Int32Array.from(mesh.corner_verts)), corner_edges: bin.add(Int32Array.from(mesh.corner_edges)), ...(uvs && { uvs: bin.add(Float32Array.from(uvs)) }),
  };
}

// The `live` stacks' settings added to `controls`, and their operations.
export function modifierOperations(world, live, controls, bin) {
  return [...live].map(([node, stack]) => {
    const ob = idStruct(world.mainSync.objectOf(node)), names = [...ob.modifiers].filter((m) => m.show_viewport).map((m) => m.name);
    const settings = stack.modifiers.map(({ type, layouts, values }, i) => ({
      type, layouts, values: Object.fromEntries(Object.entries(values).map(([path, value]) => {
        const float = typeof value === 'number' && layouts[/^\w+/.exec(path)[0]]?.kind === 'float';
        controls.push(knob(`objects${key(ob.name)}.modifiers${key(names[i])}.${path}`, value, float ? { type: 'FLOAT' } : {}, { node: node.id, channel: channelKey(i, path) }));
        return [path, controls.length - 1];
      })),
    }));
    return { evaluator: 'modifiers', reads: settings.flatMap((m) => Object.values(m.values)), writes: [], data: { node: node.id, base: baseBuffers(stack.mesh, bin), stack: settings } };
  });
}
