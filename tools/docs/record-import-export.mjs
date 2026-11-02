// Records docs/features/import-export.md's media: the Default Cube deleted, File > Import (its add-ons' entries live)
// > Wavefront (.obj) with the example's suzanne.obj and suzanne.mtl, the importer's options, the result, and File >
// Export's menu and options.
//   usage: node tools/docs/record-import-export.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]';
const FILES = ["suzanne.obj", "suzanne.mtl"].map((name) => new URL(`../../examples/import-export/${name}`, import.meta.url).pathname);
const DIALOG = (title) => `[role="dialog"][aria-label="${title}"]`;

await record("import-export", { node: "Cube" }, async (r) => {
  const { app } = r;
  const fileMenu = async (submenu) => {
    await app.page.click('[data-blender="TOPBAR_MT_file"]');
    await app.page.getByRole("menuitem", { name: new RegExp(`^${submenu}`) }).first().hover();
    // The add-ons' rows (glTF 2.0, ...) are live once Python, which opening File starts, has registered them.
    await app.page.locator('.bl-menu-item[aria-disabled="false"]', { hasText: "glTF 2.0" }).waitFor({ timeout: 180000 });
    await r.pause(300);
  };
  await app.click();
  await r.keys("Delete");
  await fileMenu("Import");
  await r.shot("import-menu", null, { part: [0, 0, 0.45, 0.72] });
  const chooser = app.page.waitForEvent("filechooser");
  await app.page.getByRole("menuitem", { name: "Wavefront (.obj)" }).click();
  await (await chooser).setFiles(FILES);
  const options = app.frame().locator(DIALOG("Import Wavefront OBJ"));
  await options.waitFor();
  await r.shot("import-options", options);
  await options.getByRole("button", { name: "Import Wavefront OBJ" }).click();
  await app.until((b) => b.world.objects.some((node) => node.name === "Suzanne"));
  await app.settled();
  await r.shot("imported", VIEW);
  await r.shot("thumbnail", VIEW, { part: [0.2, 0.1, 0.8, 0.9] });
  await app.page.keyboard.press("Escape");
  await fileMenu("Export");
  await r.shot("export-menu", null, { part: [0, 0, 0.45, 0.72] });
  await app.page.getByRole("menuitem", { name: "STL (.stl)" }).click();
  const exportOptions = app.frame().locator(DIALOG("Export STL"));
  await exportOptions.waitFor();
  await r.shot("export-options", exportOptions);
});
