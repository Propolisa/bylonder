// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The scene's clips (docs/ir.md, Clips): an animation group per Blender action, which plays on Babylon's own clock as a
// .glb's animation groups do, apart from the playhead. While clips play, the timeline's groups blend with them: a target
// a clip that replaces sets is left to it, and an additive clip adds to what the timeline sets. The scene's markers are
// told as the playhead passes them, an action's as its clip plays past them (Babylon's AnimationEvents).
import { AnimationEvent } from '@babylonjs/core/Animations/animationEvent.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

/** @typedef {import('@babylonjs/core').AnimationGroup} AnimationGroup */
/** A marker passed: the scene's (`clip` null) or a clip's action's, at its frame there. @typedef {{ name: string, frame: number, clip: string | null }} MarkerEvent */
/**
 * How a clip plays: `loop` true for ever, false once, or a number of times (unset: the NLA strip's repeat, else for
 * ever); `speed`, times its own (unset: its strip's); `weight`, its share where clips blend (unset: its strip's
 * influence).
 * @typedef {{ loop?: boolean | number, speed?: number, weight?: number }} PlayOptions
 */

/** Whether an animation group, or one serialized, is a clip. @param {{ metadata?: any }} group */
export const isClip = (group) => !!group.metadata?.bylonder?.clip;

/**
 * The clips of a scene and what plays them.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('./ir.js').Time} time
 * @param {ReturnType<typeof import('./playhead.js').createPlayhead>} playhead
 */
export function createClips(scene, time, playhead) {
  /** Told of each marker passed. @type {Observable<MarkerEvent>} */
  const onMarker = new Observable();
  const groups = new Map(scene.animationGroups.filter(isClip).map((group) => [group.name, group]));
  const exported = new Map([...groups.values()].map((group) => [group, { speed: group.speedRatio, weight: group.weight }]));
  /** @type {Map<AnimationGroup, () => void>} */
  const endings = new Map();

  // An action's markers as events on its clip's first animation, a copy of its own: a copy of an asset shares its animations.
  for (const [name, group] of groups) {
    const { action, frame_start } = group.metadata.bylonder, markers = time.clips[action]?.markers ?? [], first = group.targetedAnimations[0];
    if (!markers.length || !first) continue;
    first.animation = first.animation.clone();
    for (const marker of markers) first.animation.addEvent(new AnimationEvent(marker.frame - frame_start, () => onMarker.notifyObservers({ ...marker, clip: name })));
  }

  // The scene's markers as the playhead passes them playing, through the loop back to the start too.
  let last = playhead.frame;
  const passing = playhead.onChanged.add(({ frame, playing }) => {
    const from = last;
    last = frame;
    if (!playing || frame === from) return;
    const passed = (/** @type {number} */ at) => (frame > from ? at > from && at <= frame : at > from || at <= frame);
    for (const marker of time.markers) if (passed(marker.frame)) onMarker.notifyObservers({ ...marker, clip: null });
  });

  const playing = () => [...groups.values()].filter((group) => group.isPlaying);
  // The timeline blends with the clips playing (a weight of its own), else plays alone.
  const retime = () => {
    const clips = playing(), claimed = new Set(clips.filter((group) => !group.isAdditive).flatMap((group) => group.targetedAnimations.map((t) => t.target)));
    playhead.claimed = (target) => claimed.has(target);
    for (const group of scene.animationGroups) if (!isClip(group)) group.weight = clips.length ? 1 : -1;
    playhead.refresh();
  };
  /** @param {string} name */
  const clip = (name) => {
    const group = groups.get(name);
    if (!group) throw new Error(`No clip "${name}": the scene's clips are ${[...groups.keys()].map((n) => `"${n}"`).join(', ') || 'none'}`);
    return group;
  };
  /** @param {AnimationGroup} group */
  const unwatch = (group) => {
    endings.get(group)?.();
    endings.delete(group);
  };

  return {
    onMarker,
    /** The clips: each one's name and Babylon's animation group. */
    list: () => [...groups].map(([name, group]) => ({ name, group })),
    /**
     * Plays a clip from its start.
     * @param {string} name
     * @param {PlayOptions} [options]
     */
    play(name, { loop, speed, weight } = {}) {
      const group = clip(name), own = /** @type {{ speed: number, weight: number }} */ (exported.get(group));
      const repeat = Math.max(1, Math.round(time.clips[group.metadata.bylonder.action]?.repeat ?? 1));
      const times = loop ?? (repeat > 1 ? repeat : true);
      unwatch(group);
      group.speedRatio = speed ?? own.speed;
      group.weight = weight ?? (own.weight === -1 ? 1 : own.weight);
      group.stop();
      group.play(times !== false);
      // Played its times, it holds its last frame, and the timeline takes its targets back.
      let played = 0;
      const looped = group.onAnimationGroupLoopObservable.add(() => {
        if (typeof times !== 'number' || ++played < times) return;
        group.pause();
        group.goToFrame(group.to, true);
        retime();
      });
      const ended = group.onAnimationGroupEndObservable.add(retime);
      endings.set(group, () => { looped.remove(); ended.remove(); });
      retime();
      return group;
    },
    /** Stops a clip, its targets left where it set them until the timeline or another clip sets them. @param {string} name */
    stop(name) {
      const group = clip(name);
      unwatch(group);
      group.stop();
      retime();
    },
    /** Sets a clip's weight. @param {string} name @param {number} weight */
    setWeight(name, weight) {
      clip(name).weight = weight;
    },
    /**
     * Fades from one clip to another over `seconds`: `to` plays (from its start unless it plays already) as `from` fades out
     * and stops. Resolves when done.
     * @param {string} from
     * @param {string} to
     * @param {number} seconds
     * @param {PlayOptions} [options] how `to` plays
     * @returns {Promise<void>}
     */
    crossFade(from, to, seconds, options = {}) {
      const out = clip(from), into = clip(to);
      const fromWeight = out.isPlaying ? Math.max(out.weight, 0) : 0;
      if (!into.isPlaying) this.play(to, options);
      const toWeight = options.weight ?? Math.max(into.weight, 0);
      into.weight = 0;
      let t = 0;
      return new Promise((done) => {
        const fade = scene.onBeforeAnimationsObservable.add(() => {
          t = seconds > 0 ? Math.min(1, t + scene.getEngine().getDeltaTime() / 1000 / seconds) : 1;
          out.weight = fromWeight * (1 - t);
          into.weight = toWeight * t;
          if (t < 1) return;
          fade.remove();
          if (out !== into) this.stop(from);
          done();
        });
      });
    },
    dispose() {
      for (const group of endings.keys()) unwatch(group);
      passing.remove();
      onMarker.clear();
    },
  };
}
