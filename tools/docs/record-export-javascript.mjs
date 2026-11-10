// Records docs/features/import-export.md's pictures of File > Export > JavaScript's settings on the Rigged Character
// example: the dialog with every setting inherited, then the package's runtime set to Babylon (native) and the rig's
// overridden back to Blender from its context menu; then its Units with the shader nodes replaced but one. On the
// Compositor example, its Branches with Upstairs Bar's Smooth by Angle set Live and the compositor Baked.
//   usage: node tools/docs/record-export-javascript.mjs
import { record } from "./record.mjs";

const TITLE = "Export JavaScript";

// Opens File > Export > JavaScript: its dialog, and a row of its tree by name.
async function openDialog(app) {
  await app.page.click('[data-blender="TOPBAR_MT_file"]');
  await app.page.getByRole("menuitem", { name: /^Export/ }).first().hover();
  await app.page.getByRole("menuitem", { name: "JavaScript (.zip)" }).click();
  const dialog = app.frame().locator(`[role="dialog"][aria-label="${TITLE}"]`);
  await dialog.waitFor();
  return { dialog, row: (name) => dialog.locator(`[role="treeitem"][aria-label="${name}"]`).first() };
}
const choose = async (app, row, name, value) => {
  await row(name).getByRole("button", { name: new RegExp(`^${name}:`) }).click();
  await app.frame().getByRole("menuitem", { name: value }).click();
};

await record("import-export", { example: "rigged-character", node: null }, async (r) => {
  const { app } = r;
  const { dialog, row } = await openDialog(app);
  await row("Armature deform").getByRole("button", { name: "Expand" }).click();
  await r.pause(300);
  await r.shot("export-javascript", dialog);
  await choose(app, row, "Runtime", "Babylon (native)");
  await row("Rig").locator("> div").first().click({ button: "right" });
  await app.frame().getByRole("menuitem", { name: "Blender" }).click();
  await r.pause(300);
  await r.shot("export-javascript-override", dialog);
  await row("Runtime").getByRole("button", { name: "Collapse" }).first().click();
  await choose(app, row, "Shader Nodes", "Replaced");
  await row("Shader Nodes").getByRole("button", { name: "Expand" }).first().click();
  await choose(app, row, "Principled BSDF", "Blender (GPL)");
  await r.pause(300);
  await r.shot("export-javascript-units", dialog);
});

await record("import-export", { example: "compositor", node: null }, async (r) => {
  const { app } = r;
  const { row } = await openDialog(app);
  await row("Geometry Nodes").getByRole("button", { name: "Expand" }).click();
  await choose(app, row, "Upstairs Bar", "Live");
  await choose(app, row, "Compositor", "Baked");
  await r.pause(300);
  await r.shot("export-javascript-branches", row("Branches"));
});
