// Records docs/features/package-view.md's media: the Package View chosen for an area of the Scripting workspace,
// Reload, and the page following an edit made in the app.
// usage: node tools/docs/record-package-view.mjs
import { record } from "./record.mjs";

const VIEW = "#package-section";

await record("package-view", { example: "rigged-character", node: "Body" }, async (r) => {
  const { app } = r;
  // The 3D View above, the Package View below: the editor and the page side by side.
  await r.area("package");
  await r.gif("open", undefined, async () => {
    await app.locator('button:has-text("Reload")').click();
    await app.locator("text=Loaded").waitFor({ timeout: 180000 });
    await app.locator(VIEW).waitFor();
    await r.pause(5000);
  });
  await r.gif("follow", undefined, async () => {
    await r.outliner("Key");
    await app.hover(0.5, 0.4);
    await r.keys("G X 1", "g", "x", "1", "Enter");
    await app.locator("text=/^Patched/").waitFor({ timeout: 180000 });
    await r.pause(2500);
  });
  await r.shot("thumbnail");
});
