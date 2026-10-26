// Adapter between Bylonder and the KubeezCut embed (kubeezcut-embed). The only module that imports KubeezCut,
// so another sequencer engine can replace it by implementing the same functions. KubeezCut (about 8 MB) loads on
// first use, when a Video Sequencer or File Browser area is shown.
//   project(): { id, name, width, height, fps } from the Bylonder project, scene output size and scene time
let loading = null;

export function createSequencerAdapter({ project, notify = console.warn, commit = () => {} }) {
  const load = () => (loading ??= (async () => {
    const [embed] = await Promise.all([import('kubeezcut-embed'), import('kubeezcut-embed/embed.css')]);
    await import('./theme.css');
    // Blender's icons replace KubeezCut's where an equivalent exists (served from public/icons/blender).
    embed.setIconBase(import.meta.env.BASE_URL + 'icons/blender');
    embed.setKeymap('blender');
    await embed.openProject({ project: project(), notify: (message) => notify(message), commit });
    return embed;
  })());
  const mounts = { sequencer: 'mountSequencer', preview: 'mountPreview', media: 'mountMedia', properties: 'mountStripProperties' };
  return {
    // kind: 'sequencer' | 'preview' | 'media' | 'properties'. Resolves to { dispose() }.
    async mount(kind, element) {
      const embed = await load();
      return embed[mounts[kind]](element);
    },
    // Adds files to the media pool by reference (File System Access handles, including private file system ones).
    async importMedia(handles) { return (await load()).importMedia(handles); },
    // Places a media pool entry on the Sequencer at a frame (default: the playhead). Resolves to the strip ids.
    async addMediaStrip(mediaId, options) { return (await load()).addMediaStrip(mediaId, options); },
    // Header menus (View, Select, Marker, Add, Strip): { [menu]: [{ label, keys, run, enabled } | '-'] }.
    async menus() { return (await load()).menus(); },
    get loaded() { return !!loading; },
    async dispose() { if (loading) (await loading).disposeAll(); loading = null; },
  };
}
