// Records docs/features/geometry-nodes.md's media: Geometry Nodes built from the Default Cube's scene, as the
// Geometry Nodes Meadow example's Scatter group starts: a grid, its modifier and New, points, instances, a modifier
// input from the Group Input's empty socket, and a node group.
// usage: node tools/docs/record-geometry-nodes.mjs
import { record } from "./record.mjs";

const EDITOR = ".bl-node-editor";

await record("geometry-nodes", {}, async (r) => {
  const { app, page } = r;
  const editorAt = async (fx, fy) => {
    const box = await app.locator(EDITOR).boundingBox();
    return [box.x + box.width * fx, box.y + box.height * fy];
  };
  // A socket by its identifier's start: a group's sockets are Socket_0, Socket_1 ...
  const socket = (node, side, id) => app.locator(`[data-node="${node}"] [data-socket^="${side}:${id}"]`).first();
  const center = async (locator) => { const b = await locator.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const link = async (from, fromId, to, toId) => r.drag(await center(socket(from, "out", fromId)), await center(socket(to, "in", toId)));
  // Shift A, typed search, Enter, placed with a click.
  const add = async (search, fx, fy) => {
    const at = await editorAt(fx, fy);
    await page.mouse.move(...at, { steps: 6 });
    await r.keys("Shift A", "Shift+A");
    await app.locator(".bl-menu").waitFor();
    await page.keyboard.type(search, { delay: 60 });
    await r.pause(400);
    await page.keyboard.press("Enter");
    await app.settled();
    await page.mouse.move(at[0] + 10, at[1] + 5, { steps: 4 });
    await page.mouse.click(at[0] + 10, at[1] + 5);
    await app.settled();
  };

  await r.gif("grid", undefined, async () => {
    await app.hover(0.5, 0.5);
    await r.keys("Delete");
    await r.menu(app.locator('[data-blender="VIEW3D_MT_add"]'), "Mesh", "Grid");
    await r.pause(800);
  });
  await r.tab("Modifiers");
  await r.gif("modifier", ".bl-properties", async () => {
    await r.menu(app.locator(".bl-properties-region").getByRole("button", { name: "Add Modifier" }), "Geometry Nodes");
    await app.locator(".bl-properties-region").getByRole("button", { name: "New" }).first().click();
    await app.settled();
    await r.pause(800);
  });
  await r.gif("workspace", undefined, async () => {
    await page.click('[data-workspace="geometry-nodes"]');
    await app.settled();
    await app.locator('[data-node="NodeGroupOutput"]').waitFor();
    await r.pause(1200);
  });
  await r.gif("points", EDITOR, async () => {
    await add("Distribute Points on Faces", 0.4, 0.25);
    await link("NodeGroupInput", "Socket", "GeometryNodeDistributePointsOnFaces", "Mesh");
    await link("GeometryNodeDistributePointsOnFaces", "Points", "NodeGroupOutput", "Socket");
    await r.pause(1000);
  });
  await r.gif("instances", EDITOR, async () => {
    await add("Instance on Points", 0.62, 0.2);
    await add("Cone", 0.4, 0.7);
    await link("GeometryNodeDistributePointsOnFaces", "Points", "GeometryNodeInstanceOnPoints", "Points");
    await link("GeometryNodeMeshCone", "Mesh", "GeometryNodeInstanceOnPoints", "Instance");
    await link("GeometryNodeInstanceOnPoints", "Instances", "NodeGroupOutput", "Socket");
    await r.pause(1000);
  });
  await r.gif("input", undefined, async () => {
    await link("NodeGroupInput", "__extend__", "GeometryNodeDistributePointsOnFaces", "Density");
    await r.pause(600);
    await r.field(app.locator(".bl-properties-region"), "Density", 3);
    await r.pause(1000);
  });
  await r.gif("group", EDITOR, async () => {
    const cone = await center(app.locator('[data-node="GeometryNodeMeshCone"]').first());
    await page.mouse.click(cone[0], cone[1] - 20);
    await r.keys("Ctrl G", "Control+g");
    await r.pause(1000);
    await r.keys("Tab", "Tab");
    await r.pause(1200);
    await r.keys("Ctrl Tab", "Control+Tab");
    await r.pause(800);
  });
  await r.shot("thumbnail");
});
