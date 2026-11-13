export const reach: (options?: Partial<{
    /** The hand's role. */
    hand: string;
    /** A node or point to reach. */
    target: Target | null;
    /** Seconds the hand takes to go half way. */
    halfLife: number;
}> | undefined) => import("../api.js").Effect<any>;
export type Target = import("@babylonjs/core").TransformNode | Vector3;
import { Vector3 } from '@babylonjs/core';
