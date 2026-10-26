// Opens the Blender Coverage modal (Splash Screen > Blender Coverage). Loads its code and data on first use.
export async function openCoverage() {
  const [{ createApp, h, ref, watch }, { default: CoverageDialog }] = await Promise.all([
    import("vue"),
    import("./CoverageDialog.vue"),
    import("@/editors/interface/components/tailwind.css"),
  ]);
  const host = document.body.appendChild(document.createElement("div"));
  const open = ref(true);
  const app = createApp({ render: () => h(CoverageDialog, { open: open.value, "onUpdate:open": (v) => (open.value = v) }) });
  // Unmount after the close transition so focus returns cleanly.
  watch(open, (v) => { if (!v) setTimeout(() => { app.unmount(); host.remove(); }, 0); });
  app.mount(host);
}
