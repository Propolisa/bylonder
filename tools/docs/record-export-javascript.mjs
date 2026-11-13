// Records docs/features/import-export.md's pictures of File > Export > JavaScript's settings on the Rigged Character
// example: the dialog with every setting inherited, then the package's runtime set to Babylon (native) and the rig's
// overridden back to Blender from its context menu; then its Units with the shader nodes replaced but one. On the
// Compositor example, its Branches with Upstairs Bar's Smooth by Angle set Live and the compositor Baked. On the
// Nonlinear Animation example, Animations set to Clips.
//   usage: node tools/docs/record-export-javascript.mjs
import { record } from "./record.mjs";

await record("import-export", { example: "rigged-character", node: null }, async (r) => {
  const { app } = r;
  const { dialog, row, choose } = await r.exportDialog();
  await row("Armature deform").getByRole("button", { name: "Expand" }).click();
  await r.pause(300);
  await r.shot("export-javascript", dialog);
  await choose("Runtime", "Babylon (native)");
  await row("Rig").locator("> div").first().click({ button: "right" });
  await app.frame().getByRole("menuitem", { name: "Blender" }).click();
  await r.pause(300);
  await r.shot("export-javascript-override", dialog);
  await row("Runtime").getByRole("button", { name: "Collapse" }).first().click();
  await choose("Shader Nodes", "Replaced");
  await row("Shader Nodes").getByRole("button", { name: "Expand" }).first().click();
  await choose("Principled BSDF", "Blender (GPL)");
  await r.pause(300);
  await r.shot("export-javascript-units", dialog);
});

await record("import-export", { example: "compositor", node: null }, async (r) => {
  const { row, choose } = await r.exportDialog();
  await row("Geometry Nodes").getByRole("button", { name: "Expand" }).click();
  await choose("Upstairs Bar", "Live");
  await choose("Compositor", "Baked");
  await r.pause(300);
  await r.shot("export-javascript-branches", row("Branches"));
});

await record("import-export", { example: "nla", node: null }, async (r) => {
  const { dialog, choose } = await r.exportDialog();
  await choose("Animations", "Clips");
  await r.pause(300);
  await r.shot("export-javascript-clips", dialog);
});
