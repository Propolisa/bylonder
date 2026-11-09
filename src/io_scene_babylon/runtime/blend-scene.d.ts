/**
 * Blender's rotation of a mode as Babylon's quaternion: Babylon's (x, y, z) is Blender's (x, z, y), its rotations
 * turning the other way.
 * @param {string} mode
 * @param {number[]} values
 */
export function babylonRotation(mode: string, values: number[]): Quaternion;
/**
 * A scene exported from Bylonder, loaded: `url` is its scene.js.
 * @param {import('@babylonjs/core').AbstractEngine} engine
 * @param {string | URL} url
 * @returns {Promise<BlendScene>}
 */
export function loadBlendScene(engine: import("@babylonjs/core").AbstractEngine, url: string | URL): Promise<BlendScene>;
/**
 * The exported scene and its controls.
 * @template {Record<string, Value>} [Controls=Record<string, Value>]
 */
export class BlendScene<Controls extends Record<string, Value> = Record<string, Value>> {
    /**
     * @param {import('@babylonjs/core').Scene} scene
     * @param {Knob[]} knobs
     * @param {{ root?: string, world?: { set(color: number[]): void }, compositor?: import('@babylonjs/core').NodeRenderGraph }} [options]
     * the package's URL, which relative image URLs resolve against, the world of one color its background controls set
     * (world.js), and the compositor its pass controls set (bylonder-blocks.js)
     */
    constructor(scene: import("@babylonjs/core").Scene, knobs: Knob[], { root, world, compositor }?: {
        root?: string;
        world?: {
            set(color: number[]): void;
        };
        compositor?: import("@babylonjs/core").NodeRenderGraph;
    });
    /** Told of each control's new value. @type {Observable<Change>} */
    onChanged: Observable<Change>;
    /** Babylon's scene. */
    scene: import("@babylonjs/core").Scene;
    /** The compositor, a NodeRenderGraph of the blocks library's passes, when the scene composites. */
    compositor: import("@babylonjs/core").NodeRenderGraph | undefined;
    /**
     * A control's value.
     * @template {keyof Controls & string} P
     * @param {P} path
     * @returns {Controls[P]}
     */
    get<P extends keyof Controls & string>(path: P): Controls[P];
    /**
     * Sets a control, and what it binds to.
     * @template {keyof Controls & string} P
     * @param {P} path
     * @param {Controls[P]} value
     */
    set<P extends keyof Controls & string>(path: P, value: Controls[P]): void;
    /** The controls, as Blender's RNA describes them. @returns {Control[]} */
    controls(): Control[];
    /** Disposes of the scene. */
    dispose(): void;
    #private;
}
export type Value = number | boolean | string;
/**
 * A control as Blender's RNA describes its property: its type, default and UI range, subtype and unit, and whether the
 * export suggests it to authors and UIs.
 */
export type Control = {
    path: string;
    type: "FLOAT" | "INT" | "BOOLEAN" | "STRING";
    default: Value;
    soft_min?: number | undefined;
    soft_max?: number | undefined;
    subtype?: string | undefined;
    unit?: string | undefined;
    suggested?: boolean | undefined;
};
/**
 * How an object's location, rotation and scale place its node: Blender's rotation mode; the parent inverse matrix
 * (Babylon's axes) when not the identity; a turn (x, y, z, w) before the object's own, a camera's to look along +Z or an
 * area light's rig's to hold its rectangle in its XY plane; for a light, the local direction the rotation turns into its
 * `direction` (null for a point light, which has none).
 */
export type Transform = {
    mode: string;
    parent_inverse?: number[] | undefined;
    offset?: number[] | undefined;
    direction?: number[] | null | undefined;
};
/**
 * Where a control's value lands: a property of a node (by id) or of the scene, scaled by `factor`; the node's place
 * (`transform`); visibility (`hide`); a focal length as a field of view (`lens`: half the sensor's fitted size); or a
 * node material's InputBlock (`material` and `block`, and the `component` of a vector) or ImageSourceBlock (`image`: the
 * value is the image's URL, relative to the package) or a material's own `property`; the scene's animation at a frame
 * (`frame`); or a compositor pass (`compositor`, the block's name): one of its
 * uniforms (`uniform`, `component`) or a float its plan uploads (`upload`, its offset in the plan's data).
 */
export type Binding = {
    node?: string | undefined;
    material?: string | undefined;
    block?: string | undefined;
    component?: number | undefined;
    image?: boolean | undefined;
    /**
     * the world's Background color or strength (world.js)
     */
    world?: boolean | undefined;
    frame?: boolean | undefined;
    compositor?: string | undefined;
    uniform?: number | undefined;
    upload?: number | undefined;
    property?: string | undefined;
    factor?: number | undefined;
    transform?: Transform | undefined;
    hide?: "viewport" | "render" | undefined;
    lens?: number | undefined;
};
export type Knob = Control & {
    bind?: Binding;
};
export type Change = {
    path: string;
    value: Value;
};
import { Quaternion } from '@babylonjs/core';
import { Observable } from '@babylonjs/core';
