/**
 * The navigation of a scene's view: `look(camera)` shows a camera's view, `navigate(mode)` moves it.
 * @param {import('@babylonjs/core').Scene} scene
 */
export function createNavigation(scene: import("@babylonjs/core").Scene): {
    readonly mode: Navigation;
    readonly camera: import("@babylonjs/core").TargetCamera;
    /** The scene's own cameras, which the page can look through. */
    cameras: () => import("@babylonjs/core").Camera[];
    /**
     * Moves the view by a mode, from where it is now.
     * @param {Navigation} next
     */
    navigate(next: Navigation): void;
    /**
     * Looks through another of the scene's cameras, as its author placed it.
     * @param {import('@babylonjs/core').TargetCamera} camera
     */
    look(camera: import("@babylonjs/core").TargetCamera): void;
    dispose(): void;
};
export type Navigation = "FIXED" | "ORBIT" | "FLY" | "WALK" | "JOYSTICKS";
