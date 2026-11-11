// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The page's one clock (docs/ir.md, Scene and collections): the scene's frame, which Babylon's animation groups and
// what reads the frame follow. Playing, it advances by the time each drawn frame takes at the scene's frame rate,
// through sub-frames, or in whole frames as Blender's Frame Dropping shows them with `snap`. Past the end it loops to
// the start, the last frame held for a whole frame as Blender's screen_animation_step does, or stops there. Each started
// animation group is held paused and set to the frame; a particle system pauses with it. An effect kept on real time
// plays on Babylon's own clock instead. A target with a time offset (`offsetOf`, a collection's) plays its animation
// that many frames later, its frame wrapped into the range as the playhead loops, else held at its ends.
import { Observable, Scene } from '@babylonjs/core';

/** @typedef {import('@babylonjs/core').AnimationGroup | import('@babylonjs/core').IParticleSystem} Effect */
/** @typedef {{ frame: number, playing: boolean }} PlayheadState */

/**
 * The scene's playhead, at its time's current frame and paused.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('./ir.js').Time} time
 */
export function createPlayhead(scene, time) {
  const { frame_start: start, frame_end: end, loop } = time, length = end - start + 1;
  let clock = time.frame_current, playing = false, snap = false, applied = NaN;
  /** @type {Set<Effect>} */
  const realTime = new Set();
  /** The particle systems paused with the playhead, with their speeds. @type {Map<import('@babylonjs/core').IParticleSystem, number>} */
  const paused = new Map();
  /** Told of each frame shown and each play and pause. @type {Observable<PlayheadState>} */
  const onChanged = new Observable();

  // The last frame holds until the loop goes back to the first.
  const held = (/** @type {number} */ frame) => (frame > end && frame < end + 1 ? end : frame);
  const shown = () => /** @type {number} */ (held(snap ? Math.floor(clock) : clock));
  /** A frame shifted back by an offset, wrapped into the range or held at its ends. @param {number} frame @param {number} offset */
  const shifted = (frame, offset) => {
    if (!offset) return frame;
    const at = frame - offset;
    return loop ? held(start + ((((at - start) % length) + length) % length)) : Math.min(end, Math.max(start, at));
  };
  /** Sets the groups that follow the playhead to its frame and tells. */
  const apply = () => {
    const frame = shown();
    if (frame === applied) return;
    applied = frame;
    for (const group of scene.animationGroups) {
      if (!group.isStarted || realTime.has(group)) continue;
      if (group.isPlaying) group.pause();
      for (const animatable of group.animatables) animatable.goToFrame(shifted(frame, playhead.offsetOf(animatable.target)), true);
    }
    onChanged.notifyObservers({ frame, playing });
  };
  const freeze = () => {
    for (const system of scene.particleSystems) if (!realTime.has(system) && !paused.has(system)) {
      paused.set(system, system.updateSpeed);
      system.updateSpeed = 0;
    }
  };
  const thaw = () => {
    for (const [system, speed] of paused) system.updateSpeed = speed;
    paused.clear();
  };

  const tick = scene.onBeforeAnimationsObservable.add(() => {
    if (!playing) return;
    const delta = scene.useConstantAnimationDeltaTime ? 16 : Math.max(Scene.MinDeltaTime, Math.min(scene.getEngine().getDeltaTime(), Scene.MaxDeltaTime));
    clock += (delta / 1000) * playhead.fps;
    if (clock >= end + 1) {
      if (loop) clock = start + ((clock - start) % (end - start + 1));
      else {
        clock = end;
        playhead.pause();
      }
    }
    apply();
  });

  const playhead = {
    /** The scene's frame shown, a sub-frame between whole frames unless it snaps. */
    get frame() { return shown(); },
    get playing() { return playing; },
    /** The range played, from its first frame to its last, as the scene's frame_start and frame_end. */
    start, end,
    /** Frames per second: fps / fps_base, as Blender's. */
    fps: time.fps / time.fps_base,
    /** The frames a target's animation is offset by (later); 0 unless set. @type {(target: any) => number} */
    offsetOf: () => 0,
    /** The frame shown by what is offset by `offset` frames. @param {number} offset */
    frameAt: (offset) => shifted(shown(), offset),
    /** Sets the groups to the frame again, after offsets changed. */
    refresh() {
      applied = NaN;
      apply();
    },
    /** Whether it shows whole frames only, as Blender's Frame Dropping does. */
    get snap() { return snap; },
    set snap(value) {
      snap = value;
      apply();
    },
    onChanged,
    play() {
      if (playing) return;
      if (!loop && clock >= end) clock = start;
      playing = true;
      thaw();
      onChanged.notifyObservers({ frame: shown(), playing });
    },
    pause() {
      if (!playing) return;
      playing = false;
      freeze();
      onChanged.notifyObservers({ frame: shown(), playing });
    },
    /** Moves to a frame, sub-frames too, playing on from there if it plays. @param {number} frame */
    seek(frame) {
      if (!Number.isFinite(frame)) return;
      clock = frame;
      apply();
    },
    /**
     * Keeps an animation group or particle system on real time, playing on Babylon's own clock whatever the playhead
     * does, or (`on` false) has it follow the playhead again.
     * @param {Effect} effect
     * @param {boolean} [on]
     */
    keepRealTime(effect, on = true) {
      if (on) {
        realTime.add(effect);
        if ('goToFrame' in effect) effect.play(effect.loopAnimation);
        else if (paused.has(effect)) {
          effect.updateSpeed = /** @type {number} */ (paused.get(effect));
          paused.delete(effect);
        }
      } else {
        realTime.delete(effect);
        playhead.refresh();
        if (!playing) freeze();
      }
    },
    dispose() {
      scene.onBeforeAnimationsObservable.remove(tick);
      onChanged.clear();
    },
  };
  apply();
  freeze();
  return playhead;
}
