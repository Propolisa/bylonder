export const gaze: (options?: Partial<{
    /** Nodes, cameras or points worth looking at; empty entries (a scene without a camera yet) are skipped. */
    targets: (Target | null | undefined)[];
    /** How near a target must be to be looked at, in metres. */
    near: number;
    /** Never glance away. */
    stare: boolean;
    /** Turn the eyes (else the head alone). */
    eyes: boolean;
    /** The most the head turns from the body's forward, in radians: about the vertical, and up or down. */
    turn: {
        yaw: number;
        pitch: number;
    };
}> | undefined) => import("../api.js").Effect<any>;
export type Target = import("@babylonjs/core").TransformNode | import("@babylonjs/core").Camera | Vector3;
import { Vector3 } from '@babylonjs/core';
