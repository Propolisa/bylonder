import { openRenderContext } from '../render/render-context.js';

// A scene's sound (Blender's scene mixdown), as KubeezCut's SceneAudioSource gives it to Scene Audio strips and the
// render job to video: the scene's own audio renders offline in a render context of its own over the scene's frames.
// Each scene's sound is kept until the scene changes (its revision).
const SAMPLE_RATE = 48000;

// The sound of a run payload over frames frameStart..frameEnd at fps: { samples: Float32Array per channel, sampleRate },
// or null if the scene makes none.
export async function renderSceneAudio(payload, { frameStart, frameEnd, fps }) {
  const { context, dispose } = await openRenderContext(payload, { width: 2, height: 2 }, { audio: { frameStart, frameEnd, fps, sampleRate: SAMPLE_RATE } });
  try {
    const audio = await context.renderAudio();
    // Copied out of the render context's window, which goes with it.
    return audio && { samples: audio.samples.map((channel) => new Float32Array(channel)), sampleRate: audio.sampleRate };
  } finally {
    dispose();
  }
}

export function createSceneAudio({ payload, revision, scenes, notify = console.warn }) {
  const rendered = new Map(), listeners = new Set();
  return {
    // The scene's sound over its whole frame range; null if the scene is gone or makes none.
    getAudio(scene) {
      const key = revision(scene);
      if (rendered.get(scene)?.key !== key) {
        const range = scenes().find((s) => s.id === scene);
        rendered.set(scene, { key, audio: range ? renderSceneAudio(payload(scene), range).catch((error) => { notify(`Scene audio of ${range.name}: ${error.message}`); return null; }) : Promise.resolve(null) });
      }
      return rendered.get(scene).audio;
    },
    revision,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // A scene changed: its sound renders again when next asked for.
    changed() { for (const listener of listeners) listener(); },
  };
}
