// The 3D Viewport looking through the scene camera in Rendered shading without overlays, its camera frame filling
// the view (Home), as a feature page's finished piece and thumbnail show it.
export async function rendered(r) {
  const { app } = r;
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
  await r.keys("Home");
  await app.page.evaluate(() => document.querySelectorAll("[data-key-overlay]").forEach((key) => key.remove()));
  await r.pause(3000);
}
