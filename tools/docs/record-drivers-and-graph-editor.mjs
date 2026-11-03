// Records docs/features/drivers-and-graph-editor.md's media on the Steam Engine example: the engine playing, the
// flywheel's F-curve and its Cycles modifier in the Graph Editor, a key moved to change its speed, the crosshead's
// driver in the Drivers editor, the gauge needle's Noise modifier, and a render.
// usage: node tools/docs/record-drivers-and-graph-editor.mjs
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]';

await record("drivers-and-graph-editor", { example: "drivers-and-graph-editor", node: "Flywheel" }, async (r) => {
  const { app, page } = r;
  const select = async (name) => {
    await app.bylonder((b, name) => { b.editor.selection.replace([b.world.scene.getNodeByName(name)]); b.editor.reconcile(); }, name);
    await app.settled();
  };
  // The Timeline's area, made taller and turned into `editor` by its Editor Type menu.
  const header = () => app.locator(".dock-heading").filter({ has: app.frame().getByRole("button", { name: "View", exact: true }) }).last();
  const editorType = async (editor) => {
    await header().locator('[data-blender="ui_type"]').click();
    await app.frame().getByRole("menuitem", { name: editor }).first().click();
    await app.settled();
    await r.pause(800);
  };
  const timeline = await header().boundingBox();
  await r.drag([timeline.x + 300, timeline.y - 3], [timeline.x + 300, 380]);

  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await app.bylonder((b) => b.views.input.setShading("material"));
  await r.gif("play", VIEW, async () => {
    await app.hover();
    await r.keys("Space", " ");
    await r.pause(3500);
    await r.keys("Space", " ");
  });

  const area = await app.locator('[data-section="timeline"]').first().boundingBox();
  const over = () => page.mouse.move(area.x + area.width * 0.4, area.y + area.height / 2);
  // View > Sidebar in the area's header; Normalize, which fits each curve to -1..1; a tab of the sidebar.
  const sidebar = async () => {
    await header().getByRole("button", { name: "View", exact: true }).click();
    await app.frame().getByRole("menuitem", { name: "Sidebar" }).first().click();
    await app.settled();
  };
  const normalize = async () => {
    await header().getByRole("button", { name: "Normalize" }).first().click();
    await app.settled();
  };
  const sidebarTab = async (name) => {
    const tab = app.locator('[data-section="timeline"]').getByText(name, { exact: true }).last();
    if (await tab.count()) await tab.click();
    await app.settled();
    await r.pause(600);
  };

  await select("Flywheel");
  await editorType("Graph Editor");
  await sidebar();
  await normalize();
  await sidebarTab("Modifiers");
  await r.shot("graph-editor", area);

  // Both keys scaled in time to half (A, S X 0.5): the flywheel turns twice as fast. Ctrl Z puts them back.
  await r.gif("speed", { x: 0, y: 26, width: 1280, height: 720 }, async () => {
    await over();
    await r.keys("A", "a");
    await r.keys("S X 0.5", "s", "x", "0", ".", "5", "Enter");
    await app.hover();
    await r.keys("Space", " ");
    await r.pause(3000);
    await r.keys("Space", " ");
    await over();
    await r.keys("Ctrl Z", "Control+z");
  });

  await select("Crosshead");
  await editorType("Drivers");
  await sidebarTab("Drivers");
  await r.shot("drivers", area);

  await select("Needle");
  await editorType("Graph Editor");
  await sidebarTab("Modifiers");
  await r.shot("noise", area);

  await page.click('[data-blender="TOPBAR_MT_render"]');
  await page.getByRole("menuitem", { name: "Render Image" }).click();
  await app.until(() => /^(Finished|Render failed)/.test(document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, 600000);
  const png = await app.frame().evaluate(() => document.querySelector(".render-result canvas").toDataURL("image/png"));
  writeFileSync(`${r.out}full.png`, Buffer.from(png.split(",")[1], "base64"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${r.out}full.png`, "-vf", "scale=800:-2:flags=lanczos", `${r.out}thumbnail.png`]);
  rmSync(`${r.out}full.png`);
});
