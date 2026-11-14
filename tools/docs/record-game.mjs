// Records docs/features/game.md's media: the Game area played beside the 3D View, and the running game following an
// edit made in the app.
// usage: node tools/docs/record-game.mjs
import { record } from "./record.mjs";

const AREA = "#game-section";

await record("game", { example: "rigged-character", node: "Body" }, async (r) => {
  const { app } = r;
  // The 3D View above, the Game below: the editor and the page side by side.
  await r.area("game");
  await r.gif("play", undefined, async () => {
    await app.locator(`${AREA} button[title^="Play"]`).click();
    await app.locator(`${AREA} iframe[title="Game"]`).waitFor({ timeout: 180000 });
    await app.locator(`${AREA} >> text=Playing`).waitFor({ timeout: 180000 });
    await r.pause(5000);
  });
  await r.gif("edit", undefined, async () => {
    await r.outliner("Key");
    await app.hover(0.5, 0.4);
    await r.keys("G X 1", "g", "x", "1", "Enter");
    await app.locator(`${AREA} >> text=/^Patched/`).waitFor({ timeout: 180000 });
    await r.pause(2500);
  });
  await r.shot("thumbnail");
});
