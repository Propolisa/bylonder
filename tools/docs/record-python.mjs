// Records docs/features/python.md's media on the Python example: Run Script on wave.py, a line in the Python Console,
// the Scatter Cubes add-on installed from Preferences and used.   usage: node tools/docs/record-python.mjs
import { readFileSync } from "node:fs";
import { record } from "./record.mjs";

const TEXT = '[data-blender="TEXT_EDITOR"]', CONSOLE = '[data-blender="CONSOLE"]', VIEW = '[data-section="viewport"]';
const addon = readFileSync(new URL("../../examples/python/scatter_cubes.py", import.meta.url));

await record("python", { example: "python" }, async (r) => {
  const { app, page } = r;
  await page.click('[data-workspace="scripting"]');
  await app.locator(CONSOLE).waitFor();
  await app.until(() => /PYTHON\s*INTERACTIVE\s*CONSOLE/.test(document.querySelector('[data-blender="CONSOLE"]').textContent), null, 180000);
  // The Text Editor shows wave.py, as picking it from its text menu would.
  await app.bylonder((b) => {
    const { bpyRna } = b.modules, context = bpyRna.contextStruct();
    for (const area of context.screen.areas) if (area.type === "TEXT_EDITOR") area.spaces.active.text = bpyRna.blendData().texts.get("wave.py");
  });
  await app.locator(TEXT).hover();
  await app.settled();
  await r.gif("run-script", undefined, async () => {
    await app.locator(TEXT).hover();
    await r.keys("Alt P", "Alt+p");
    await r.pause(1500);
  });
  await r.shot("thumbnail", VIEW, { part: [0.15, 0.15, 0.85, 0.85] });
  await r.gif("console", CONSOLE, async () => {
    await app.locator(CONSOLE).hover();
    for (const line of ["C.object.name", "len(D.objects)"]) {
      await page.keyboard.type(line, { delay: 80 });
      await r.keys("Enter");
    }
  });
  // The browser's file dialog is outside the page: the file chooser gets the add-on.
  page.on("filechooser", (chooser) => chooser.setFiles({ name: "scatter_cubes.py", mimeType: "text/x-python", buffer: addon }));
  await r.gif("install-addon", undefined, async () => {
    await page.click('[data-blender="TOPBAR_MT_edit"]');
    await page.getByRole("menuitem", { name: "Preferences..." }).click();
    const prefs = app.locator("[data-blender=PREFERENCES_WINDOW]");
    await prefs.locator("[data-blender=USERPREF_PT_navigation_bar]").getByText("Add-ons", { exact: true }).click();
    await prefs.getByText("Node Wrangler").first().waitFor({ timeout: 180000 });
    await prefs.locator('[data-blender="USERPREF_MT_addons_settings"]').first().click();
    await app.frame().getByRole("menuitem", { name: "Install from Disk..." }).first().click();
    await r.pause(800);
    await app.frame().getByRole("button", { name: "Install from Disk" }).last().click();
    await prefs.getByText("Scatter Cubes").first().waitFor({ timeout: 30000 });
    await app.settled();
    await r.pause(1000);
    await prefs.getByRole("button", { name: "Close" }).click();
  });
  await r.gif("use-addon", VIEW, async () => {
    await app.hover(0.5, 0.6);
    await r.keys("Shift A", "Shift+A");
    await app.frame().getByRole("menuitem", { name: "Scatter Cubes" }).last().click();
    await app.settled();
    await app.hover(0.5, 0.6);
    await r.keys("Ctrl Shift R", "Control+Shift+R");
  });
});
