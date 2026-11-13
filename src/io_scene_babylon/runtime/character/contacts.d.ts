/**
 * An action's contacts for `legs` (the role `legs`: chains of bone names, root to foot).
 * @param {import('./clip.js').Clip} clip @param {Skeleton} skeleton @param {string[][]} legs
 * @returns {Contacts}
 */
export function footContacts(clip: import("./clip.js").Clip, skeleton: Skeleton, legs: string[][]): Contacts;
/**
 * An action's contacts: as the export found them from Blender's evaluation of the rig (the package's clip entry), else
 * found now from the action's own pose.
 * @param {{ clip: import('./clip.js').Clip, character: { blend: any, rig: Skeleton, roles: Record<string, any> } }} action
 * @returns {Contacts}
 */
export function contactsOf({ clip, character }: {
    clip: import("./clip.js").Clip;
    character: {
        blend: any;
        rig: Skeleton;
        roles: Record<string, any>;
    };
}): Contacts;
/** How much leg `leg` is down at `time` seconds, 0 to 1, between frames linearly. @param {Contacts} contacts */
export function contactAt(contacts: Contacts, leg: number, time: number): number;
/** The longest span with no foot down, as [start, end] in seconds, or null: a jump's flight. @param {Contacts} contacts */
export function flight(contacts: Contacts): [number, number] | null;
/**
 * Contacts from the feet's paths in the world (Y up, metres), one point a frame: each leg's ankle and ball, and the
 * body's root; `legLength` scales what counts as low; `markers` (in seconds) start contacts where they are L or R.
 * The export runs it on Blender's evaluation of the deform feet, the page on its own pose where an action has none.
 * @param {{ ankles: number[][][], balls: number[][][], root: number[][], fps: number, legLength: number,
 *   markers?: { name: string, time: number }[] }} paths
 * @returns {Contacts}
 */
export function contactsFromTracks({ ankles, balls, root, fps, legLength, markers }: {
    ankles: number[][][];
    balls: number[][][];
    root: number[][];
    fps: number;
    legLength: number;
    markers?: {
        name: string;
        time: number;
    }[];
}): Contacts;
export type Skeleton = {
    names: string[];
    parents: Int32Array;
    rest: Float32Array;
    boneIndex(name: string): number;
};
/**
 * per leg, 1 on each frame its foot is down;
 *  `speed` the ground speed in m/s
 */
export type Contacts = {
    down: Uint8Array[];
    speed: number;
    fps: number;
};
