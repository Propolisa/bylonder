// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The page's one clock (docs/ir.md, Scene and collections): the scene's frame, which Babylon's animation groups and
// what reads the frame follow. Playing, it advances by the time each drawn frame takes at the scene's frame rate,
// through sub-frames, or in whole frames as Blender's Frame Dropping shows them with `snap`. Past the end it loops to
// the start, the last frame held for a whole frame as Blender's screen_animation_step does, or stops there. Each started
// animation group is held paused and set to the frame; a particle system pauses with it. An effect kept on real time
// plays on Babylon's own clock instead.
import { Observable, Scene } from '@babylonjs/core';

/** @typedef {import('@babylonjs/core').AnimationGroup | import('@babylonjs/core').IParticleSystem} Effect */
/** @typedef {{ frame: number, playing: boolean }} PlayheadState */

/**
 * The scene's playhead, at its time's current frame and paused.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('./ir.js').Time} time
 */
export function createPlayhead(scene, time) {
  const { frame_start: start, frame_end: end, loop } = time;
  let clock = time.frame_current, playing = false, snap = false, applied = NaN;
  /** @type {Set<Effect>} */
  const realTime = new Set();
  /** The particle systems paused with the playhead, with their speeds. @type {Map<import('@babylonjs/core').IParticleSystem, number>} */
  const paused = new Map();
  /** Told of each frame shown and each play and pause. @type {Observable<PlayheadState>} */
  const onChanged = new Observable();

  // The last frame holds until the loop goes back to the first.
  const shown = () => /** @type {number} */ (clock > end && clock < end + 1 ? end : snap ? Math.floor(clock) : clock);
  /** Sets the groups that follow the playhead to its frame and tells. */
  const apply = () => {
    const frame = shown();
    if (frame === applied) return;
    applied = frame;
    for (const group of scene.animationGroups) {
      if (!group.isStarted || realTime.has(group)) continue;
      if (group.isPlaying) group.pause();
      group.goToFrame(frame, true);
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
        applied = NaN;
        apply();
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
