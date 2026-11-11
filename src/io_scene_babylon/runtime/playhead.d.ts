/** @typedef {import('@babylonjs/core').AnimationGroup | import('@babylonjs/core').IParticleSystem} Effect */
/** @typedef {{ frame: number, playing: boolean }} PlayheadState */
/**
 * The scene's playhead, at its time's current frame and paused.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('./ir.js').Time} time
 */
export function createPlayhead(scene: import("@babylonjs/core").Scene, time: import("./ir.js").Time): {
    /** The scene's frame shown, a sub-frame between whole frames unless it snaps. */
    readonly frame: number;
    readonly playing: boolean;
    /** The range played, from its first frame to its last, as the scene's frame_start and frame_end. */
    start: number;
    end: number;
    /** Frames per second: fps / fps_base, as Blender's. */
    fps: number;
    /** The frames a target's animation is offset by (later); 0 unless set. @type {(target: any) => number} */
    offsetOf: (target: any) => number;
    /** The frame shown by what is offset by `offset` frames. @param {number} offset */
    frameAt: (offset: number) => number;
    /** Sets the groups to the frame again, after offsets changed. */
    refresh(): void;
    /** Whether it shows whole frames only, as Blender's Frame Dropping does. */
    snap: boolean;
    onChanged: Observable<PlayheadState>;
    play(): void;
    pause(): void;
    /** Moves to a frame, sub-frames too, playing on from there if it plays. @param {number} frame */
    seek(frame: number): void;
    /**
     * Keeps an animation group or particle system on real time, playing on Babylon's own clock whatever the playhead
     * does, or (`on` false) has it follow the playhead again.
     * @param {Effect} effect
     * @param {boolean} [on]
     */
    keepRealTime(effect: Effect, on?: boolean): void;
    dispose(): void;
};
export type Effect = import("@babylonjs/core").AnimationGroup | import("@babylonjs/core").IParticleSystem;
export type PlayheadState = {
    frame: number;
    playing: boolean;
};
import { Observable } from '@babylonjs/core';
