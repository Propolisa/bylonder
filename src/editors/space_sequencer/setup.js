import { bylonderPreferences } from '../../workspace/preferences.js';
import { preferencesChanged } from '../../windowmanager/wm-userdef.js';

// Asks what to set up (SequencerSetup.vue): resolves to { video, scene, audio, remember }, all false when declined,
// or null when dismissed.
async function ask(props) {
  const [{ createApp, h }, { default: SequencerSetup }] = await Promise.all([
    import('vue'),
    import('./SequencerSetup.vue'),
    import('@/editors/interface/components/tailwind.css'),
  ]);
  const host = document.body.appendChild(document.createElement('div'));
  return new Promise((resolve) => {
    const app = createApp({ render: () => h(SequencerSetup, { ...props, onDone: (choice) => { setTimeout(() => { app.unmount(); host.remove(); }, 0); resolve(choice); } }) });
    app.mount(host);
  });
}

// When the Video Sequencer opens on an empty edit, sets it up as asked, or as remembered (Edit > Preferences asks
// again): Blender's FFmpeg output in MPEG-4 (H.264, with AAC audio for the scene's sound) instead of PNG images, the
// active scene as a strip from its first frame, and its Scene Audio beside it.
//   render(): the scene's RNA render settings; time: scene time; add(menu, scene): runs Add > menu > scene
export async function offerSequencerSetup({ empty, scene, render, time, add, commit }) {
  if (!empty()) return;
  const prefs = bylonderPreferences();
  const choice = prefs.ask_sequencer_setup ? await ask({ scene: scene.name, video: render().image_settings.file_format === 'FFMPEG' })
    : { video: prefs.sequencer_setup_video, scene: prefs.sequencer_setup_scene, audio: prefs.sequencer_setup_audio };
  if (!choice || !empty()) return;
  if (choice.remember) {
    Object.assign(prefs, { sequencer_setup_video: choice.video, sequencer_setup_scene: choice.scene, sequencer_setup_audio: choice.audio, ask_sequencer_setup: false });
    preferencesChanged();
  }
  const audio = choice.scene && choice.audio;
  if (choice.video) {
    const { image_settings, ffmpeg } = render();
    // Blender lists FFmpeg among the file formats of video output only.
    Object.assign(image_settings, { media_type: 'VIDEO', file_format: 'FFMPEG' });
    Object.assign(ffmpeg, { format: 'MPEG4', codec: 'H264' }, audio ? { audio_codec: 'AAC' } : {});
    commit();
  }
  if (!choice.scene) return;
  const frame = time.frame;
  time.seek(time.state.frameStart);
  await add('Scene', scene);
  if (audio) await add('Scene Audio', scene);
  time.seek(frame);
}
