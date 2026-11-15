// Records docs/features/project-files.md's media: the Project Files example's Explorer, its actions, File > Open Folder
// on a folder (one in the browser's private file system stands in for one picked on disk) and an edit made there.
// usage: node tools/docs/record-project-files.mjs
import { record } from "./record.mjs";

const PICKED = "Cafe";

await record("project-files", { example: "project-files", node: "Counter", size: { width: 1600, height: 950 } }, async (r) => {
  const { app, page } = r;
  const tree = page.locator(".bl-file-tree");
  const row = (name) => tree.locator('[role="treeitem"]', { hasText: new RegExp(`^${name}$`) });
  // Window > Toggle Project Code, until the code shows beside the scene.
  for (let i = 0; i < 2 && !(await tree.isVisible()); i++) {
    await page.click('[data-blender="TOPBAR_MT_window"]');
    await page.getByRole("menuitem", { name: "Toggle Project Code" }).click();
    await r.pause();
  }
  await tree.waitFor();
  await row("src").click();
  await row("counter.js").click();
  await r.pause();
  const explorer = await page.locator("#explorer").boundingBox(), code = await page.locator("#code-pane").boundingBox();
  const region = { x: explorer.x, y: explorer.y, width: explorer.width + Math.min(code.width, 560), height: Math.min(explorer.height, 360) };
  await r.shot("thumbnail", region);

  // The Explorer: a new folder and file named in place, a rename with F2, a drag, the right-click menu.
  await r.gif("explorer", region, async () => {
    await tree.getByTitle("New Folder").click();
    await page.keyboard.type("systems", { delay: 60 });
    await page.keyboard.press("Enter");
    await row("systems").click();
    await tree.getByTitle("New File").click();
    await page.keyboard.type("shift.js", { delay: 60 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("export const length = 30;\n", { delay: 30 });
    await row("shift.js").click();
    await row("shift.js").press("F2");
    await page.keyboard.press("Control+a");
    await page.keyboard.type("clock.js", { delay: 60 });
    await page.keyboard.press("Enter");
    await row("clock.js").dragTo(row("src"));
    await r.pause(400);
    await row("clock.js").click({ button: "right" });
    await r.pause(900);
    await page.keyboard.press("Escape");
  });

  // File > Open Folder: an empty folder takes the project's files; the status bar names it.
  await page.evaluate((name) => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true }); }, PICKED);
  await page.click('[data-blender="TOPBAR_MT_file"]');
  await page.getByRole("menuitem", { name: "Open Folder..." }).click();
  await page.locator("#storage-status", { hasText: `Folder: ${PICKED}` }).waitFor();
  await page.waitForFunction(async (name) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    return (await Array.fromAsync(dir.keys())).some((file) => file.endsWith(".blend"));
  }, PICKED, { timeout: 120000, polling: 500 });
  // The project runs again from the folder: its scene's frame is a new one.
  await page.waitForFunction(() => document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.editor, null, { timeout: 120000 });
  await r.pause(1500);
  await r.shot("open-folder", { x: 0, y: 0, width: 1600, height: 950 }, { part: [0, 0.94, 1, 1] });

  // An edit made in the folder by another tool shows when the page has the focus again.
  await r.gif("outside-edit", region, async () => {
    await page.evaluate(async (name) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
      const content = await dir.getDirectoryHandle("content", { create: true });
      const writer = await (await content.getFileHandle("menu.txt", { create: true })).createWritable();
      await writer.write("Espresso\nFlat white\nGravel latte\nSediment mocha\n");
      await writer.close();
    }, PICKED);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await row("content").click();
    await row("menu.txt").click();
    await r.pause(800);
  });
  await app.settled();
});
