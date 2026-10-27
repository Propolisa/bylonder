// Opens the changelog (Splash Screen > Changelog). Loads its code and the commit list on first use.
export async function openChangelog() {
  const [{ createApp, h, ref, watch }, { default: ChangelogDialog }] = await Promise.all([
    import('vue'),
    import('./ChangelogDialog.vue'),
    import('@/editors/interface/components/tailwind.css'),
  ]);
  const host = document.body.appendChild(document.createElement('div'));
  const open = ref(true);
  const app = createApp({ render: () => h(ChangelogDialog, { open: open.value, 'onUpdate:open': (v) => (open.value = v) }) });
  watch(open, (v) => { if (!v) setTimeout(() => { app.unmount(); host.remove(); }, 0); });
  app.mount(host);
}
