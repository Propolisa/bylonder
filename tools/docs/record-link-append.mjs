// Records docs/features/link-append.md's media: the Link and Append example through its camera in Rendered shading,
// then on the Default Cube: the cube deleted, File > Link with the example's library.blend browsed in Blender's File
// Browser (Collection, then Street Lamp), Object > Library Override > Make, File > Append of the Bench, and the
// Outliner's Blender File view.
//   usage: node tools/docs/record-link-append.mjs
import { record } from "./record.mjs";

await record("link-append", { example: "link-append", node: null }, async (r) => {
  await r.pause(3000);
  await r.render("thumbnail", { part: [0.05, 0, 0.95, 1] });
});

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
  await open("Street Lamp");
  await app.until((b) => b.world.objects.some((node) => node.name === "Street Lamp"));
  await r.shot("linked", VIEW);
  await r.menu("VIEW3D_MT_object", "Library Override", "Make");
  await app.until((b) => b.world.objects.some((node) => node.name === "Post"));
  await r.shot("override", VIEW);
  await browse("Append...");
  await open("Object");
  await open("Bench");
  await app.until((b) => b.world.objects.some((node) => node.name === "Bench"));
  await r.shot("appended", VIEW);
  // The Outliner maximized (Ctrl Space), in its Blender File view, one level more shown (Numpad +).
  const outliner = '[data-section="objects"]';
  await app.locator(outliner).hover();
  await r.keys("Ctrl Space", "Control+Space");
  await r.menu(app.locator('[data-blender="display_mode"]'), "Blender File");
  await app.locator(outliner).hover();
  await r.keys("Numpad +", "NumpadAdd");
  await r.shot("blender-file", outliner, { part: [0, 0, 0.5, 0.6] });
});
