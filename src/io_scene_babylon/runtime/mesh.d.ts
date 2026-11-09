/**
 * An IR mesh's draw buffers: Blender's (x, y, z) is Babylon's (x, z, y).
 * @param {import('./ir.js').Mesh} mesh
 * @returns {DrawBuffers}
 */
export function triangulate({ vert_positions: p, face_offsets, corner_verts, uvs, attributes }: import("./ir.js").Mesh): DrawBuffers;
/**
 * Draws a value an entity gives on the node's mesh: draw buffers, an IR mesh, or geometry.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} node
 * @param {any} value
 * @param {Drawing} [drawing]
 */
export function drawGeometry(scene: import("@babylonjs/core").Scene, node: string, value: any, { meshBuffers, nodeOf, greasePencil, curves }?: Drawing): Promise<void>;
/**
 * Draw buffers; `groups` are the triangles of each material index as [index, first index, index count].
 */
export type DrawBuffers = {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    uvs?: Float32Array;
    groups?: [number, number, number][];
};
/**
 * How geometry is drawn: a mesh's draw buffers (a kernel's, else `triangulate`), and the Babylon node an ID draws as.
 * A Grease Pencil layer's drawing and curves, under their object's node (grease-pencil.js drawLayer, curves.js drawCurves).
 */
export type Drawing = {
    meshBuffers?(mesh: import("./ir.js").Mesh): DrawBuffers | Promise<DrawBuffers>;
    nodeOf?(id: string): string | undefined;
    greasePencil?(node: string, layer: any): Promise<void>;
    curves?(node: string, curves: any): Promise<void>;
};
