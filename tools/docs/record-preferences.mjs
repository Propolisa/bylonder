// Records docs/features/preferences.md's media: Edit > Preferences over the Default Cube and its sections.
// usage: node tools/docs/record-preferences.mjs
import { record } from "./record.mjs";

const WINDOW = "[data-blender=PREFERENCES_WINDOW]";

await record("preferences", {}, async (r) => {
  const { app } = r;
  const prefs = app.locator(WINDOW);
  const section = async (name) => {
    await prefs.locator("[data-blender=USERPREF_PT_navigation_bar]").getByText(name, { exact: true }).click();
    await app.settled();
  };
  await app.page.click('[data-blender="TOPBAR_MT_edit"]');
  await app.page.getByRole("menuitem", { name: "Preferences..." }).click();
  await prefs.waitFor();
  await app.settled();
  await r.shot("open");
  await section("Input");
  for (const description of ["Emulate Middle Mouse with Alt+Left Mouse", "Main 1 to 0 keys act as the numpad ones"]) await prefs.locator(`label[title^="${description}"]`).click();
  await app.settled();
  await r.shot("input", WINDOW);
  await section("Keymap");
  await r.shot("keymap", WINDOW);
  await section("Themes");
  await r.shot("themes", WINDOW);
  await section("System");
  await prefs.getByText("Keep Scenes Loaded").scrollIntoViewIfNeeded();
  await r.shot("bylonder", WINDOW);
  await r.shot("thumbnail", WINDOW, { part: [0, 0, 0.6, 0.6] });
});
