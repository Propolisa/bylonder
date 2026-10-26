// The only module that imports KubeezCut (kubeezcut-embed); another sequencer engine replaces it by implementing
// the same functions. KubeezCut loads on first use. The edit lives in the scene's sequenceEditor slice, undo in
// Bylonder's history and the playhead is the scene frame.
let loading = null;

export function createSequencerAdapter({ project, sequenceEditor, time, history, frames, scenes, notify = console.warn }) {
  const clock = {
    get frame() { return time.frame; },
    get playing() { return time.playing; },
    subscribe: (fn) => time.subscribe((kind) => { if (kind === 'frame' || kind === 'playback' || kind === 'load') fn(); }),
    seek: (frame) => time.seek(frame),
    play: () => { if (!time.playing) time.play(); },
    pause: () => time.pause(),
  };
  const load = () => (loading ??= (async () => {
    const [embed] = await Promise.all([import('kubeezcut-embed'), import('kubeezcut-embed/embed.css')]);
    await import('./theme.css');
    embed.setIconBase(import.meta.env.BASE_URL + 'icons/blender');
    embed.setKeymap('blender');
    await embed.openProject({
      project: project(),
      edit: sequenceEditor.state?.edit,
      history: {
        commit: (edit) => sequenceEditor.set({ engine: 'kubeezcut', edit }),
        undo: history.undo,
        redo: history.redo,
      },
      clock,
      frames,
      scenes,
      notify: (message) => notify(message),
    });
    sequenceEditor.subscribe((source) => { if (source === 'apply') embed.setHostEdit(sequenceEditor.state?.edit); });
    return embed;
  })());
  const mounts = { sequencer: 'mountSequencer', preview: 'mountPreview', media: 'mountMedia', properties: 'mountStripProperties' };
  return {
    async mount(kind, element) { return (await load())[mounts[kind]](element); },
    async importMedia(handles) { return (await load()).importMedia(handles); },
    async addMediaStrip(mediaId, options) { return (await load()).addMediaStrip(mediaId, options); },
    async menus() { return (await load()).menus(); },
    // The edit's frames and mixed audio for a render job; see openCompositor in kubeezcut-embed.
    async openCompositor(range) { return { label: 'Sequencer', ...(await (await load()).openCompositor(range)) }; },
    async setFormat(format) { if (loading) (await loading).setProjectFormat(format); },
    get loaded() { return !!loading; },
    async dispose() { if (loading) (await loading).disposeAll(); loading = null; },
  };
}
