/**
 * The clips of a scene and what plays them.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('./ir.js').Time} time
 * @param {ReturnType<typeof import('./playhead.js').createPlayhead>} playhead
 * @param {(path: string, value: any) => void} [set] the page's control setter, for clips' keyed properties
 */
export function createClips(scene: import("@babylonjs/core").Scene, time: import("./ir.js").Time, playhead: ReturnType<typeof import("./playhead.js").createPlayhead>, set?: (path: string, value: any) => void): {
    onMarker: Observable<MarkerEvent>;
    /** The clips: each one's name and Babylon's animation group. */
    list: () => {
        name: string;
        group: import("@babylonjs/core").AnimationGroup;
    }[];
    /**
     * Plays a clip from its start.
     * @param {string} name
     * @param {PlayOptions} [options]
     */
    play(name: string, { loop, speed, weight }?: PlayOptions): import("@babylonjs/core").AnimationGroup;
    /** Stops a clip, its targets left where it set them until the timeline or another clip sets them. @param {string} name */
    stop(name: string): void;
    /** Sets a clip's weight. @param {string} name @param {number} weight */
    setWeight(name: string, weight: number): void;
    /**
     * Fades from one clip to another over `seconds`: `to` plays (from its start unless it plays already) as `from` fades out
     * and stops. Resolves when done.
     * @param {string} from
     * @param {string} to
     * @param {number} seconds
     * @param {PlayOptions} [options] how `to` plays
     * @returns {Promise<void>}
     */
    crossFade(from: string, to: string, seconds: number, options?: PlayOptions): Promise<void>;
    /** Whether a started clip keys a property. @param {string} path */
    holds: (path: string) => boolean;
    dispose(): void;
};
export function isClip(group: {
    metadata?: any;
}): boolean;
export type AnimationGroup = import("@babylonjs/core").AnimationGroup;
/**
 * A marker passed: the scene's (`clip` null) or a clip's action's, at its frame there.
 */
export type MarkerEvent = {
    name: string;
    frame: number;
    clip: string | null;
};
/**
 * How a clip plays: `loop` true for ever, false once, or a number of times (unset: the NLA strip's repeat, else for
 * ever); `speed`, times its own (unset: its strip's); `weight`, its share where clips blend (unset: its strip's
 * influence).
 */
export type PlayOptions = {
    loop?: boolean | number;
    speed?: number;
    weight?: number;
};
import { Observable } from '@babylonjs/core';
