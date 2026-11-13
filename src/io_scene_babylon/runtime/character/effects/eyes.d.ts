export const eyes: (options?: Partial<{
    /** Seconds between blinks, on average. */
    blinkEvery: number;
}> | undefined) => import("../api.js").Effect<{
    eyes: {
        bone: any;
        eye: {
            target: number;
            lookAt(pose: import("../api.js").Pose, point: Vector3, amount: number, limit?: number): void;
            glance(pose: import("../api.js").Pose, yaw: number, pitch: number): void;
        };
    }[];
    lids: number[][];
    blink: number;
    twice: boolean;
    look: number;
    yaw: number;
    pitch: number;
}>;
import { Vector3 } from '@babylonjs/core';
