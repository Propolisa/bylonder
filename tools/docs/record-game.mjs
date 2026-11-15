// Records docs/features/game.md's media: the Game area played beside the 3D View, the running game following an edit
// made in the app, and its modifier stack switched from Render to Viewport in its header.
// usage: node tools/docs/record-game.mjs
import { record } from "./record.mjs";

await record("game", { example: "rigged-character", node: "Body" }, async (r) => {
  const { app } = r;
  // The 3D View above, the Game below: the editor and the page side by side.
  await r.area("game");
  // The Game's header (its buttons are in the area's header) and the game under it.
  const play = app.locator('button[title^="Play the scene"]'), header = play.locator("xpath=..");
  const game = async () => {
    const top = await header.boundingBox(), area = await app.locator("#game-section").boundingBox();
    return { x: area.x, y: top.y, width: area.width, height: area.y + area.height - top.y };
  };
  await r.gif("play", undefined, async () => {
    await play.click();
    await header.locator("text=Playing").waitFor({ timeout: 180000 });
    await r.pause(4000);
  });
  await r.gif("edit", undefined, async () => {
    await r.outliner("Key");
    await app.hover(0.5, 0.4);
    await r.keys("G X 1", "g", "x", "1", "Enter");
    await header.locator("text=/^(Edited live|Up to date)/").waitFor({ timeout: 180000 });
    await r.pause(2500);
  });
  await r.shot("thumbnail");
  // Step 3: the body's Armature modifier off in viewports, on in renders (as tests/export-evaluation-wasm.test.js has
  // it), so the two stacks differ; then Viewport chosen.
  await app.bylonder((b) => { b.modules.bpyRna.blendData().objects.get("Body").modifiers[0].show_viewport = false; b.world.mainSync.view(); });
  await r.shot("stack-render", await game());
  await header.getByRole("button", { name: "Viewport", exact: true }).click();
  await header.locator("text=/Loaded fresh with the Viewport stack/").waitFor({ timeout: 180000 });
  await r.pause(2000);
  await r.shot("stack-viewport", await game());
});
