// Records docs/features/link-append.md's media: the Default Cube deleted, File > Link with the example's library.blend
// browsed in Blender's File Browser (Collection, then Props), Object > Library Override > Make, File > Append of the
// Lamp Post, and the Outliner's Blender File view.
//   usage: node tools/docs/record-link-append.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]';
const BROWSER = '[data-blender="FILE_BROWSER"]';
const LIBRARY = new URL("../../examples/link-append/libraries/library.blend", import.meta.url).pathname;

await record("link-append", { node: "Cube" }, async (r) => {
  const { app } = r;
  // File > Link... or Append..., library.blend chosen, the File Browser opened inside it.
  const browse = async (label) => {
    const chooser = app.page.waitForEvent("filechooser");
    await app.page.click('[data-blender="TOPBAR_MT_file"]');
    await app.page.getByRole("menuitem", { name: label }).first().click();
    await (await chooser).setFiles(LIBRARY);
    await app.locator(BROWSER).waitFor();
    // Blender's filelist reads the library, then the list is laid out.
    await r.pause(1000);
  };
  // A double click on an entry the File Browser lists, where its name is drawn (the list redraws as Blender's window
  // ticks, so its position is read and clicked at once).
  const open = async (name) => {
    const at = await app.frame().evaluate(([browser, text]) => {
      const r = [...document.querySelectorAll(`${browser} svg text`)].find((e) => e.textContent === text).getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    }, [BROWSER, name]);
    const frame = await (await app.frame().frameElement()).boundingBox();
    await app.page.mouse.dblclick(frame.x + at[0], frame.y + at[1]);
    await r.pause(1000);
  };
  await app.click();
  await r.keys("Delete");
  await browse("Link...");
  await open("Collection");
  await r.shot("file-browser", app.locator('[role="dialog"]'));
  await open("Props");
  await app.until((b) => b.world.objects.some((node) => node.name === "Props"));
  await r.shot("linked", VIEW);
  await r.menu("VIEW3D_MT_object", "Library Override", "Make");
  await app.until((b) => b.world.objects.some((node) => node.name === "Crate"));
  await r.shot("override", VIEW);
  await browse("Append...");
  await open("Object");
  await open("Lamp Post");
  await app.until((b) => b.world.objects.some((node) => node.name === "Lamp Post"));
  await r.shot("appended", VIEW);
  await r.shot("thumbnail", VIEW, { part: [0.2, 0.1, 0.8, 0.9] });
  // The Outliner maximized (Ctrl Space), in its Blender File view, one level more shown (Numpad +).
  const outliner = '[data-section="objects"]';
  await app.locator(outliner).hover();
  await r.keys("Ctrl Space", "Control+Space");
  await r.menu(app.locator('[data-blender="display_mode"]'), "Blender File");
  await app.locator(outliner).hover();
  await r.keys("Numpad +", "NumpadAdd");
  await r.shot("blender-file", outliner, { part: [0, 0, 0.5, 0.6] });
});
