// The Package View (docs/sdk-model.md, Previews), Bylonder's own editor: the scene as File > Export > JavaScript writes
// it, in memory, loaded in a frame with plain Babylon and the page's own load(). Reload writes it again; after each edit,
// undo or redo, once idle, the page takes the patch of the next export (package-preview.js).
import { createApp, h, reactive } from 'vue';
import PackageView from './PackageView.vue';
import { createPackagePreview, previewPage } from './package-preview.js';
import { packagedFiles } from '../../io_scene_babylon/export.js';
import { exportOptions } from '../../io_scene_babylon/export-options.js';
import { publishFiles, removeRun } from '../../workspace/module-host.js';
import { registerOperator } from '../../windowmanager/wm-operators.js';

export function mountPackageView(section, { world }) {
  const state = reactive({ url: '', status: '', busy: false }), options = exportOptions({ controlPanel: false, target: 'WEBGL2' });
  const channel = `bylonder-package-view:${crypto.randomUUID()}`, patches = new BroadcastChannel(channel);
  const preview = createPackagePreview({
    world, options, post: (patch) => patches.postMessage({ patch }), report: (status) => { state.status = status; },
    publish: async (files) => {
      const page = { ...(await packagedFiles(files, options)), 'index.html': new TextEncoder().encode(previewPage(channel)) };
      if (state.url) await removeRun(state.url.slice(0, state.url.lastIndexOf('/') + 1));
      return `${await publishFiles(page)}index.html`;
    },
  });
  const reload = async () => {
    state.busy = true;
    try { state.url = await preview.reload(); } catch (error) { state.status = `Not exported: ${error.message}`; } finally { state.busy = false; }
  };
  registerOperator('bylonder.package_view_reload', { poll: () => !state.busy, run: reload });
  createApp({ render: () => h(PackageView, { ...state, onReload: reload }) }).mount(section);
  return { changed: () => preview.changed() };
}
