// Records docs/features/import-export.md's media on the gallery example: the bust through the camera in Rendered
// shading, the bust deleted, File > Import (its add-ons' entries live) > glTF 2.0 with the example's bust.glb, the
// importer's options, the bust moved onto the plinth, and File > Export's menu and options.
//   usage: node tools/docs/record-import-export.mjs
import { fileURLToPath } from "node:url";
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]';
const GLB = fileURLToPath(new URL("../../examples/import-export/bust.glb", import.meta.url));
const DIALOG = (title) => `[role="dialog"][aria-label="${title}"]`;

await record("import-export", { example: "import-export", node: null }, async (r) => {
  const { app } = r;
  const rendered = (name) => r.render(name, { part: [0.2, 0, 0.8, 1] });
  await r.pause(3000);
  await rendered("thumbnail");
  const fileMenu = async (submenu) => {
    await app.page.click('[data-blender="TOPBAR_MT_file"]');
    await app.page.getByRole("menuitem", { name: new RegExp(`^${submenu}`) }).first().hover();
    // The add-ons' rows (glTF 2.0, ...) are live once Python, which opening File starts, has registered them.
    await app.page.locator('.bl-menu-item[aria-disabled="false"]', { hasText: "glTF 2.0" }).waitFor({ timeout: 180000 });
    await r.pause(300);
  };
  await r.outliner("Bust");
  await app.hover();
  await r.keys("Delete");
  await fileMenu("Import");
  await r.shot("import-menu", null, { part: [0, 0, 0.45, 0.72] });
  const chooser = app.page.waitForEvent("filechooser");
  await app.page.getByRole("menuitem", { name: /^glTF 2.0/ }).click();
  await (await chooser).setFiles(GLB);
  const options = app.frame().locator('[role="dialog"]').last();
  await options.waitFor();
  await r.pause(500);
  await r.shot("import-options", options);
  await options.getByRole("button", { name: /^Import/ }).last().click();
  await app.until((b) => b.world.objects.some((node) => node.name === "Bust"), null, 120000);
  await app.settled();
  await r.gif("place", VIEW, async () => {
    await app.hover();
    await r.keys("G", "g");
    await r.keys("Z", "z");
    await app.page.keyboard.type("1.1", { delay: 250 });
    await r.keys("Enter");
  });
  await rendered("imported");
  await app.page.keyboard.press("Escape");
  await fileMenu("Export");
  await r.shot("export-menu", null, { part: [0, 0, 0.45, 0.72] });
  await app.page.getByRole("menuitem", { name: "STL (.stl)" }).click();
  const exportOptions = app.frame().locator(DIALOG("Export STL"));
  await exportOptions.waitFor();
  await r.shot("export-options", exportOptions);
});
