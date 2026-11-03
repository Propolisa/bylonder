// Records docs/features/nla.md's media: a hop keyed on the Default Cube, then the Carousel example playing and its
// staggered strips in the Nonlinear Animation editor.
// usage: node tools/docs/record-nla.mjs
import { record } from "./record.mjs";
import { rendered } from "./scene-view.mjs";

const NLA = "#nla-section", HEADER = 26, VIEW = '[data-section="viewport"]';
const SCENE = { part: [0.08, 0.06, 0.92, 0.94] };

const openNla = async (r) => {
  const { app, page } = r;
  const timeline = await app.locator("#timeline-section").boundingBox();
  await page.mouse.click(timeline.x + 25, timeline.y - HEADER / 2);
  await r.pause(400);
  await app.frame().getByRole("menuitem", { name: "Nonlinear Animation", exact: true }).last().click();
  await app.settled();
  await r.drag([timeline.x + 500, timeline.y - HEADER], [timeline.x + 500, 430]);
};

await record("nla", { example: "cube", node: "Cube" }, async (r) => {
  const { app } = r;
  const type = async (...keys) => { for (const key of keys) await r.keys(key, key.toLowerCase()); };

  await r.gif("hop", undefined, async () => {
    await app.hover();
    await r.keys("I");
    await r.frame(7);
    await app.hover();
    await type("G", "Z", "1");
    await r.keys("Enter");
    await r.keys("I");
    await r.frame(13);
    await app.hover();
    await r.keys("Alt G", "Alt+g");
    await r.keys("I");
  });
});

await record("nla", { example: "carousel", node: "Platform" }, async (r) => {
  const { app, page } = r;
  await rendered(r);
  await r.frame(30);
  await r.shot("thumbnail", VIEW, SCENE);
  await r.gif("carousel", VIEW, async () => {
    await r.frame(1);
    await app.hover();
    await r.keys("Space", " ");
    await r.pause(5000);
    await r.keys("Space", " ");
  }, SCENE);
  await openNla(r);
  await app.hover();
  await r.keys("A", "a");
  const nla = await app.locator(NLA).boundingBox();
  await page.mouse.move(nla.x + nla.width / 2, nla.y + nla.height / 2);
  await r.keys("Home");
  await r.shot("strips", { x: nla.x, y: nla.y - HEADER, width: nla.width, height: nla.height + HEADER });
});
