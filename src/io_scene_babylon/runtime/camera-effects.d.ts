/** The scene's camera effects, made once its active camera is set. @param {Scene} scene */
export function cameraEffects(scene: Scene): {
    /** The camera the effects are on. */
    readonly camera: import("@babylonjs/core").Nullable<import("@babylonjs/core").Camera>;
    /**
     * Adds an effect after those added before, on the active camera unless `attached` (made on it already).
     * @template {CameraEffect} T @param {T} effect @param {boolean} [attached] @returns {T}
     */
    add<T extends CameraEffect>(effect: T, attached?: boolean): T;
    /** Takes an effect off the active camera and out of the scene's. @param {CameraEffect} effect */
    remove(effect: CameraEffect): void;
};
export function postProcessEffect(post: PostProcess, before?: PostProcess): CameraEffect & {
    post: PostProcess;
};
export function pipelineEffect(scene: Scene, name: string): CameraEffect;
export type Camera = import("@babylonjs/core").Camera;
export type Scene = import("@babylonjs/core").Scene;
export type PostProcess = import("@babylonjs/core").PostProcess;
export type CameraEffect = {
    attach(camera: Camera): void;
    detach(camera: Camera): void;
};
