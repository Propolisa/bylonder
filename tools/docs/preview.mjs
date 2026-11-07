// Screenshots examples through their scene camera, to judge a scene while making it.
//   usage: node tools/docs/preview.mjs <example>=<out.png>[:<shading>[:<wait ms>]] ...   (shading: rendered by default)
import { chromium, openApp } from "../../tests/e2e/app.mjs";

const PORT = process.env.DOCS_PORT ?? "5205";
const browser = await chromium.launch();
try {
  for (const arg of process.argv.slice(2)) await preview(arg).catch((error) => console.log(`${arg}: ${error.message.split("\n")[0]}`));
} finally {
  await browser.close();
}

async function preview(arg) {
  const [example, rest] = arg.split("=");
  const [out, shading = "rendered", wait = "8000"] = rest.split(":");
  const app = await openApp(browser, `http://localhost:${PORT}/`, { link: example, node: null, size: { width: 1280, height: 800 } });
  try {
    await shoot(app, out, shading, wait);
  } finally {
    if (app.errors.length) console.log(`${example} page errors:\n` + app.errors.join("\n"));
    await app.close();
  }
}

async function shoot(app, out, shading, wait) {
  // The example's scene replaces the viewport's first one: wait for it before driving it.
  await app.page.waitForTimeout(3000);
  await app.page.waitForFunction(() => document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.settled, null, { timeout: 120000 });
  await app.settled();
  await app.hover();
  await app.page.keyboard.press("Numpad0");
  await app.bylonder((b, shading) => { b.views.input.state.overlays = false; b.views.input.setShading(shading); }, shading);
  await app.page.mouse.move(1, 1);
  await app.page.waitForTimeout(Number(wait));
  await app.locator('[data-section="viewport"]').first().screenshot({ path: out });
}
