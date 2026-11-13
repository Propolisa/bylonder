export const locomotion: (options?: Partial<import("./api.js").Gaits> | undefined) => import("./api.js").Source<{
    /** Its actions by gait; set before playing or between plays. @type {Gaits} */ actions: Gaits;
    /** Other maps of actions by name, each over `actions`. @type {Record<string, Gaits>} */ stances: Record<string, Gaits>;
    /** The stance it plays: 'stand' or a name of `stances`. */ stance: string;
    /** Top speeds of its walk and run (m/s), which the default input and steering move at. */ speeds: {
        walk: number;
        run: number;
    };
    /** @type {Map<string, Set>} */ sets: Map<string, Set>;
    from: string;
    to: string;
    blend: Float32Array<ArrayBuffer>;
    /** The moving gaits' place on their shared cycle, and their rate (1: their own). */ phase: number;
    rate: number;
    idleTime: number;
    moving: number;
    air: Float32Array<ArrayBuffer>;
    mode: string;
    airTime: number;
    weights: Float32Array<ArrayBuffer>;
    fromWeights: Float32Array<ArrayBuffer>;
    predicted: {
        position: Vector3;
        facing: Vector3;
    };
    character: any;
    /** How much each leg (of roles.legs) is down in what it plays now, 0 to 1. */ downs: Float32Array<ArrayBuffer>;
    /** Turning in place: the yaw each foot was set down at, the leg stepping (-1 none), how far through, and the leg that stepped last. */
    feetYaw: Float32Array<ArrayBuffer>;
    stepLeg: number;
    stepDone: number;
    lastLeg: number;
    lastYaw: number;
    stepped: boolean;
    contact: (leg: number) => number;
    /** @type {import('./api.js').Sample | null} */ sample: import("./api.js").Sample | null;
    options: {
        time: number;
    };
    /** @type {{ gait: Gait | null, time: number }} */ airPose: {
        gait: Gait | null;
        time: number;
    };
    /** What played in the air last, held while it gives way. @type {{ gait: Gait | null, time: number }} */ held: {
        gait: Gait | null;
        time: number;
    };
}>;
export type Gaits = import("./api.js").Gaits;
/**
 * an action as locomotion plays it; `start` the left foot's first contact (s)
 */
export type Gait = {
    name: string;
    duration: number;
    speed: number;
    start: number;
    contacts: import("./contacts.js").Contacts;
    flight: [number, number] | null;
    stances: number[];
    swings: number[];
};
export type Set = {
    idle: Gait;
    moving: Gait[];
    jump: Gait | null;
    fall: Gait | null;
    land: Gait | null;
};
import { Vector3 } from '@babylonjs/core';
