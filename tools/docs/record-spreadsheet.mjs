// Records docs/features/spreadsheet.md's media: the Spreadsheet on the Geometry Nodes Planet example, its components
// and domains, and the original data.
// usage: node tools/docs/record-spreadsheet.mjs
import { record } from "./record.mjs";

const SHEET = '[data-blender="SPREADSHEET"]';
// A data set item clicked where its label is: the label lets the click through to the item, as in Blender.
const pick = async (app, text) => {
  const item = app.locator(`${SHEET} .bl-area-side`).getByText(text, { exact: true }).first();
  await item.scrollIntoViewIfNeeded();
  const box = await item.boundingBox();
  await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await app.settled();
};

await record("spreadsheet", { example: "geometry-nodes", node: "Planet" }, async (r) => {
  const { app, page } = r;
  await r.gif("open", undefined, async () => {
    await page.click('[data-workspace="geometry-nodes"]');
    await app.settled();
    await app.locator(SHEET).waitFor();
    await r.pause(1500);
  });
  await r.gif("domains", SHEET, async () => {
    await pick(app, "Point Cloud");
    await r.pause(1500);
    await pick(app, "Instances");
    await r.pause(1500);
  });
  await pick(app, "Mesh");
  await r.gif("original", SHEET, async () => {
    const state = app.locator(`${SHEET} [data-blender="object_eval_state"]`);
    await r.menu(state, "Original");
    await r.pause(1500);
    await r.menu(state, "Evaluated");
    await r.pause(800);
  });
  await r.shot("thumbnail", SHEET);
});
