// Records docs/features/nla.md's media: the Nonlinear Animation editor on the NLA example, its strips, a strip's
// properties, tweak mode and playback.
// usage: node tools/docs/record-nla.mjs
import { record } from "./record.mjs";

const NLA = "#nla-section", HEADER = 26;
// The editor's channel list and sidebar widths, and where its first track row starts under the scrubbing area.
const CHANNELS = 200, SIDEBAR = 280, ROWS = 24, ROW = 26;

await record("nla", { example: "nla", node: "Box" }, async (r) => {
  const { app, page } = r;
  const section = () => app.locator(NLA).boundingBox();
  const area = async () => { const b = await section(); return { x: b.x, y: b.y - HEADER, width: b.width, height: b.height + HEADER }; };
  // A point of the main region: a frame of the example's range (1 to 96) on a channel row (0 is the object's).
  const at = async (frame, row) => {
    const b = await section(), width = b.width - CHANNELS - SIDEBAR;
    return [b.x + CHANNELS + 51 + ((frame - 1) / 95) * (width - 100), b.y + ROWS + ROW / 2 + row * ROW];
  };

  const timeline = await app.locator("#timeline-section").boundingBox();
  await r.gif("open", undefined, async () => {
    await page.mouse.click(timeline.x + 25, timeline.y - HEADER / 2);
    await r.pause(400);
    await app.frame().getByRole("menuitem", { name: "Nonlinear Animation", exact: true }).last().click();
    await app.settled();
    await r.drag([timeline.x + 500, timeline.y - HEADER], [timeline.x + 500, 400]);
    await r.pause(600);
  });

  await r.gif("select", await area(), async () => {
    await page.mouse.click(...(await at(10, 3)));
    await app.settled();
    await r.pause(600);
  });
  await r.shot("thumbnail", await area());
  await r.gif("tweak", await area(), async () => {
    await page.mouse.move(...(await at(60, 5)));
    await r.keys("Tab");
    await r.pause(1000);
    await r.keys("Tab");
  });
  await r.gif("play", undefined, async () => {
    await r.keys("Space", " ");
    await r.pause(3000);
    await r.keys("Space", " ");
  });
});
