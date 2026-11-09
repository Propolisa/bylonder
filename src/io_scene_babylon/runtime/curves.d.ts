/**
 * The implementation: `run`, and `drawCurves`, which draws an entity's curves once, named by its object's node.
 * @param {import('./scheduler.js').Page} page
 */
export function load({ root, scene }: import("./scheduler.js").Page): Promise<{
    run: (inputs: Curves) => {
        geometry: {
            curves: Curves;
        };
    };
    /** @param {string} node @param {Curves} curves */
    drawCurves(node: string, { pos_rad: posRad, indirection, time, length, object_to_world: objectToWorld, faces, material, name }: Curves): void;
}>;
export function run(inputs: Curves): {
    geometry: {
        curves: Curves;
    };
};
/**
 * Main's curves draw: each evaluated point's position and radius, the drawn segments' indirection, each point's time
 * along its curve, each curve's length, the object's matrix (Blender's), the faces round each segment (the scene's Hair
 * shape), the material's id and a name unique within the object.
 */
export type Curves = {
    pos_rad: Float32Array;
    indirection: Int32Array;
    time: Float32Array;
    length: Float32Array;
    object_to_world: number[];
    faces: number;
    material: string | null;
    name: string;
};
