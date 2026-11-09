/** @typedef {import('@babylonjs/core').AbstractEngine} AbstractEngine */
/** @typedef {import('@babylonjs/core').Scene} Scene */
/** @typedef {import('@babylonjs/core').Camera} Camera */
/** @typedef {import('@babylonjs/core').PostProcess} PostProcess */
/** @typedef {import('@babylonjs/core').FrameGraph} FrameGraph */
/** @typedef {import('@babylonjs/core').Effect} Effect */
/** @typedef {import('@babylonjs/core').FrameGraphRenderContext} FrameGraphRenderContext */
/** @typedef {number} TextureHandle */
/**
 * A uniform of a fragment pass: its GLSL name and kind ('float', 'vec2', 'vec3', 'vec4', 'mat4') and its value.
 * @typedef {{ name: string, kind: string, value: number[] }} Uniform
 */
/**
 * A pass's fragment shader on the images linked into its inputs: `samplers` names each image's sampler and input,
 * `bands` the data textures (RGBA floats, one row) it samples.
 * @typedef {object} Fragment
 * @property {string} code
 * @property {Uniform[]} uniforms
 * @property {[string, string][]} samplers
 * @property {{ name: string, pixels: number[] }[]} bands
 */
/**
 * A recorded plan: textures by id with their size and format, the steps that clear, copy, upload to or draw into them,
 * which textures the inputs are and which the outputs are; `data` holds the uploads' bytes, base64.
 * @typedef {object} Plan
 * @property {{ id: number, size: number[], format: string }[]} textures
 * @property {any[]} steps
 * @property {Record<string, number>} inputs
 * @property {Record<string, { texture?: number, value?: number[] }>} outputs
 * @property {string} data
 */
/**
 * A pass: its image inputs and outputs by identifier, the input its own image is, the output its image is, and its
 * fragment shader or its plan (neither: it passes its image through).
 * @typedef {object} Pass
 * @property {string[]} inputs
 * @property {string[]} outputs
 * @property {string} [image]
 * @property {string} [result]
 * @property {Fragment} [fragment]
 * @property {Plan} [plan]
 */
/**
 * The bytes of an upload as RGBA floats, as a texture of its format holds them.
 * @param {Uint8Array} bytes
 * @param {string} format
 * @param {number[]} extent
 * @param {number} channels
 */
export function uploadFloats(bytes: Uint8Array, format: string, extent: number[], channels: number): Float32Array<ArrayBuffer>;
/**
 * Sets a uniform of a kind on an effect.
 * @param {Effect} effect
 * @param {string} name
 * @param {string} type GLSL ('vec3') or Blender's create info type ('float3')
 * @param {number[]} v
 * @param {number} [array] the length of a uniform array
 */
export function setUniform(effect: Effect, name: string, type: string, v: number[], array?: number): import("@babylonjs/core").Effect;
/**
 * Draws `source` stretched over all of `target`, sampled linearly when their sizes differ.
 * @param {AbstractEngine} engine
 */
export function textureCopier(engine: AbstractEngine): (source: any, target: any) => void;
/**
 * The export's compositor (`source`, a NodeRenderGraph's serialization whose Render Layers input is the render) on a
 * camera's render: it runs once the render is drawn, before `display` (the camera's display transform, a post process
 * of the camera), at the size its plans were recorded for (`width`, `height`), and writes its composite back.
 * @param {Scene} scene
 * @param {Camera} camera
 * @param {{ graph: any, width: number, height: number }} source
 * @param {PostProcess} display
 */
export function compositor(scene: Scene, camera: Camera, { graph: json, width, height }: {
    graph: any;
    width: number;
    height: number;
}, display: PostProcess): Promise<{
    graph: NodeRenderGraph;
    dispose: () => void;
}>;
export function formatChannels(format: string): 1 | 2 | 3 | 4;
/**
 * Babylon's post process task, which samples its source image, also binding the images linked into its other inputs,
 * as Babylon's own multi-input tasks do (FrameGraphBloomMergeTask).
 */
export class ImagesPostProcessTask extends FrameGraphPostProcessTask {
    /** Each sampler's texture. @type {Map<string, TextureHandle>} */
    inputTextures: Map<string, TextureHandle>;
    /** @param {boolean} [skipCreationOfDisabledPasses] */
    record(skipCreationOfDisabledPasses?: boolean): import("@babylonjs/core").FrameGraphRenderPass;
}
/**
 * A recorded plan as a frame graph task: its passes in order, each writing a new version of the texture it writes (a
 * pass samples the version before it), on the images linked into it (`inputTextures`, by input identifier), giving
 * `outputTextures` (by output identifier). Disabled, or with no plan, it passes `sourceTexture` through.
 */
export class ReplayTask extends FrameGraphTask {
    /**
     * @param {string} name
     * @param {FrameGraph} frameGraph
     * @param {string[]} outputs
     */
    constructor(name: string, frameGraph: FrameGraph, outputs: string[]);
    /** The plan for an image size, and its uploads' bytes. @type {(size: number[]) => { plan: any, data: Uint8Array } | null} */
    recorder: (size: number[]) => {
        plan: any;
        data: Uint8Array;
    } | null;
    /** The size the task last recorded at. @type {number[] | null} */
    size: number[] | null;
    /** @type {any} */
    plan: any;
    /** @type {Uint8Array | null} */
    data: Uint8Array | null;
    /** @type {Map<string, TextureHandle>} */
    inputTextures: Map<string, TextureHandle>;
    /** @type {TextureHandle | undefined} */
    sourceTexture: TextureHandle | undefined;
    /** @type {Map<string, TextureHandle>} */
    outputTextures: Map<string, TextureHandle>;
    /**
     * A pass's GLSL for the engine (the app specializes its samplers for WebGPU).
     * @param {string} code
     */
    shaderCode(code: string): string;
    /** Uploads the plan's data again, after a value in it changed. */
    reupload(): void;
    #private;
}
/**
 * A pass of the export's compositor: one Blender node, its code and plan made at export (`pass`), its image inputs
 * linked as in Blender's tree. A disabled (muted) block passes its image through.
 */
export class BylonderPassBlock extends NodeRenderGraphBlock {
    /**
     * @param {string} name
     * @param {FrameGraph} frameGraph
     * @param {Scene} scene
     */
    constructor(name: string, frameGraph: FrameGraph, scene: Scene);
    /** @type {Pass} */
    pass: Pass;
    /**
     * Sets a uniform's value, or one of its components, without rebuilding the graph.
     * @param {number} index
     * @param {number} value
     * @param {number} [component]
     */
    setUniform(index: number, value: number, component?: number): void;
    /**
     * Sets a value the plan uploads (a 32-bit float at `offset` in its data), without rebuilding the graph.
     * @param {number} offset
     * @param {number} value
     */
    setUpload(offset: number, value: number): void;
    /** The point linked into each input, by identifier. */
    get linked(): Map<string, any>;
    /** @param {any} state */
    _buildBlock(state: any): void;
    #private;
}
/**
 * The compositor's output: the composite's handle, which the view copies back over its render (`result`). As a frame
 * graph task it does nothing (Babylon's output block would copy to the canvas).
 */
export class CompositeOutputBlock extends NodeRenderGraphOutputBlock {
    /** The composite's handle, null when nothing is linked. @returns {TextureHandle | null} */
    get result(): TextureHandle | null;
}
export type AbstractEngine = import("@babylonjs/core").AbstractEngine;
export type Scene = import("@babylonjs/core").Scene;
export type Camera = import("@babylonjs/core").Camera;
export type PostProcess = import("@babylonjs/core").PostProcess;
export type FrameGraph = import("@babylonjs/core").FrameGraph;
export type Effect = import("@babylonjs/core").Effect;
export type FrameGraphRenderContext = import("@babylonjs/core").FrameGraphRenderContext;
export type TextureHandle = number;
/**
 * A uniform of a fragment pass: its GLSL name and kind ('float', 'vec2', 'vec3', 'vec4', 'mat4') and its value.
 */
export type Uniform = {
    name: string;
    kind: string;
    value: number[];
};
/**
 * A pass's fragment shader on the images linked into its inputs: `samplers` names each image's sampler and input,
 * `bands` the data textures (RGBA floats, one row) it samples.
 */
export type Fragment = {
    code: string;
    uniforms: Uniform[];
    samplers: [string, string][];
    bands: {
        name: string;
        pixels: number[];
    }[];
};
/**
 * A recorded plan: textures by id with their size and format, the steps that clear, copy, upload to or draw into them,
 * which textures the inputs are and which the outputs are; `data` holds the uploads' bytes, base64.
 */
export type Plan = {
    textures: {
        id: number;
        size: number[];
        format: string;
    }[];
    steps: any[];
    inputs: Record<string, number>;
    outputs: Record<string, {
        texture?: number;
        value?: number[];
    }>;
    data: string;
};
/**
 * A pass: its image inputs and outputs by identifier, the input its own image is, the output its image is, and its
 * fragment shader or its plan (neither: it passes its image through).
 */
export type Pass = {
    inputs: string[];
    outputs: string[];
    image?: string | undefined;
    result?: string | undefined;
    fragment?: Fragment | undefined;
    plan?: Plan | undefined;
};
import { NodeRenderGraph } from '@babylonjs/core';
import { FrameGraphPostProcessTask } from '@babylonjs/core';
import { FrameGraphTask } from '@babylonjs/core';
import { NodeRenderGraphBlock } from '@babylonjs/core';
import { NodeRenderGraphOutputBlock } from '@babylonjs/core';
