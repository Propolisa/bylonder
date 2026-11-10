// Records docs/features/import-export.md's pictures of File > Export > JavaScript's settings on the Rigged Character
// example: the dialog with every setting inherited, then the package's runtime set to Babylon (native) and the rig's
// overridden back to Blender from its context menu.
//   usage: node tools/docs/record-export-javascript.mjs
import { record } from "./record.mjs";

const TITLE = "Export JavaScript";

await record("import-export", { example: "rigged-character", node: null }, async (r) => {
  const { app } = r;
  await app.page.click('[data-blender="TOPBAR_MT_file"]');
  await app.page.getByRole("menuitem", { name: /^Export/ }).first().hover();
  await app.page.getByRole("menuitem", { name: "JavaScript (.zip)" }).click();
  const dialog = app.frame().locator(`[role="dialog"][aria-label="${TITLE}"]`);
  await dialog.waitFor();
  const row = (name) => dialog.locator(`[role="treeitem"][aria-label="${name}"]`).first();
  await row("Armature deform").getByRole("button", { name: "Expand" }).click();
  await r.pause(300);
  await r.shot("export-javascript", dialog);
  await row("Runtime").getByRole("button", { name: /^Runtime:/ }).click();
  await app.frame().getByRole("menuitem", { name: "Babylon (native)" }).click();
  await row("Rig").locator("> div").first().click({ button: "right" });
  await app.frame().getByRole("menuitem", { name: "Blender" }).click();
  await r.pause(300);
  await r.shot("export-javascript-override", dialog);
});
