/**
 * A material's per-mesh values set for each mesh it draws, as the app gives them (a material shared by meshes of other
 * sizes spans each one's own texture space).
 * @param {import('@babylonjs/core').Material} material
 */
export function meshValues(material: import("@babylonjs/core").Material): void;
/**
 * `e` of GLSL type `from` as type `to`, as linked sockets convert: a color (vec4) to a value by its luminance, a vector
 * by its mean, a value to all components.
 * @param {string} e @param {string} from @param {string} to
 */
export function convert(e: string, from: string, to: string): string | null;
/**
 * A GLSL literal of a value for a type, or null.
 * @param {any} value @param {string} type
 */
export function literal(value: any, type: string): string | null;
/**
 * The output node a graph draws: of its Material (or World) Outputs, one for EEVEE before one for all renderers, the
 * active one among equals, else the first.
 * @param {Graph} graph
 */
export function outputNode(graph: Graph): {
    [x: string]: unknown;
    name: string;
    type: string;
    settings: Record<string, any>;
    inputs: Record<string, any>;
};
/**
 * A graph's nodes as one GLSL body, `bl_nodes`, taking what `sources` gives (in the order asked, `inputs`) and giving
 * the output node's outputs: the code of its helper and node functions, then the body.
 * @param {IR} ir
 * @param {string} key the graph's key in `ir.graphs`
 * @param {{ kernels?: Kernels, sources: Sources, outputs?: string[], kernel?: string }} options `outputs`: the output
 * node's outputs the body gives, by socket identifier (all by default); `kernel`: the kernels' graph the nodes are
 * made from, by default the graph's own (a volume's is `<key>/volume`)
 */
export function fuse(ir: IR, key: string, { kernels, sources, outputs: wanted, kernel }: {
    kernels?: Kernels;
    sources: Sources;
    outputs?: string[];
    kernel?: string;
}): {
    outputs: string[][];
    /** @param {[string, string][]} inputs the body's parameters, GLSL name and type, in order */
    code: (inputs: [string, string][]) => string[];
};
/**
 * Fills each exported material's node block (a CustomBlock with `blender` sources: its graph's key and what each of its
 * parameters carries) with the body made from the IR, before the material is parsed.
 * @param {any[]} materials NodeMaterial serializations
 * @param {IR} ir
 * @param {Kernels} [kernels]
 */
export function fillMaterials(materials: any[], ir: IR, kernels?: Kernels): any[];
/**
 * A NodeMaterial of Babylon's own blocks for a shader graph of the IR: its nodes as one CustomBlock, unlinked inputs as
 * InputBlocks named by their property path, images as ImageSourceBlocks, the output node's closure lit by Babylon's PBR
 * block (base color, metallic, roughness and normal; its lighting weighed and its emission added).
 * @param {IR} ir
 * @param {string} key
 * @param {Scene} scene
 * @param {{ kernels?: Kernels, name?: string, image?: (name: string) => Texture | null }} [options]
 */
export function buildNodeMaterial(ir: IR, key: string, scene: Scene, { kernels, name, image }?: {
    kernels?: Kernels;
    name?: string;
    image?: (name: string) => Texture | null;
}): NodeMaterial;
/** @typedef {import('./ir.js').IR} IR */
export const MESH_VALUE: "blender:mesh:";
export type IR = import("./ir.js").IR;
export type Graph = import("./ir.js").Graph;
export type GraphNode = import("./ir.js").GraphNode;
export type Scene = import("@babylonjs/core").Scene;
export type Point = import("@babylonjs/core").NodeMaterialConnectionPoint;
/**
 * A parameter of a piece's function, in order: a node input by socket identifier (linked, its value, else `fallback`),
 * an output by socket identifier, a value of the drawn point (`geometry`: `__position`, `__normal`, `__uv`, `__world`,
 * `__view`, `__viewProjection`, `__cameraPosition`, `__tangent`), a per-mesh value (`mesh`: `$model`, `$texspace_size`)
 * or the node's `texture` by index. `type` is GLSL's: float, vec2, vec3, vec4, mat4, sampler2D or BlClosure.
 */
export type Param = {
    type: string;
    input?: string;
    output?: string;
    geometry?: string;
    mesh?: string;
    texture?: number;
    fallback?: string;
};
/**
 * A node's GLSL: the helper functions it calls by key, its own function's name and code, and its parameters.
 */
export type Piece = {
    functions: Record<string, string>;
    call: string;
    code: string;
    params: Param[];
};
/**
 * A unit for a shader node: its piece for a node of the graph (its settings and inputs).
 */
export type ShaderUnit = {
    shader(node: GraphNode): Piece;
};
/**
 * The pieces a package ships (its GPL file): helper functions by key in emission order, node functions by name, and
 * per graph the output node drawn and each node's function with the per-mesh values and textures it was made with.
 */
export type Kernels = {
    functions: Record<string, string>;
    pieces: Record<string, {
        functions: string[];
        code: string;
        params: Param[];
    }>;
    graphs: Record<string, {
        output: string;
        nodes: Record<string, {
            piece: string;
            mesh?: Record<string, number[]>;
            textures?: any[];
        }>;
    }>;
};
/**
 * What a body reads from outside it, by source key (`geometry:__position`, `value:<node>:<socket>`,
 * `texture:<node>:<index>`, `system:world`), answered with the GLSL name of a parameter of the body, or null.
 */
export type Sources = (key: string, type: string) => string | null;
import { Texture } from '@babylonjs/core';
import { NodeMaterial } from '@babylonjs/core';
