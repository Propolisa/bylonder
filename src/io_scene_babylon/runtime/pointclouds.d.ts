/**
 * The implementation: `run`, and `drawPointCloud`, which draws an entity's points once, under its object's node.
 * @param {import('./scheduler.js').Page} page
 */
export function load({ root, scene }: import("./scheduler.js").Page): Promise<{
    run: (inputs: PointCloud) => {
        geometry: {
            pointcloud: PointCloud;
        };
    };
    /** @param {string} node @param {PointCloud} cloud */
    drawPointCloud(node: string, { points, matrix, material, name }: PointCloud): void;
}>;
export function run(inputs: PointCloud): {
    geometry: {
        pointcloud: PointCloud;
    };
};
/**
 * A point cloud: 4 floats per point (its position in Blender's axes and its radius), its matrix in its object's space
 * (Babylon's layout), the material's id or name and a name unique within the object.
 */
export type PointCloud = {
    points: Float32Array;
    matrix: number[];
    material: string | null;
    name: string;
};
