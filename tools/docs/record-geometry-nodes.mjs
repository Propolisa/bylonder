// Records docs/features/geometry-nodes.md's media: a planet built with Geometry Nodes from the Default Cube's scene (an
// ico sphere, its modifier, noise terrain along the normals, a forest of cones, a modifier input), then the Geometry
// Nodes Planet example's whole tree and its render.
// usage: node tools/docs/record-geometry-nodes.mjs
import { record } from "./record.mjs";
import { nodeTools } from "./node-tools.mjs";

const EDITOR = ".bl-node-editor", VIEW = '[data-section="viewport"]';

await record("geometry-nodes", {}, async (r) => {
  const { app, page } = r;
  const { node, link, add } = nodeTools(r);
  await r.gif("sphere", undefined, async () => {
    await app.hover(0.5, 0.5);
    await r.keys("Delete");
    await r.menu(app.locator('[data-blender="VIEW3D_MT_add"]'), "Mesh", "Ico Sphere");
    const hud = app.locator("#redo-panel");
    await hud.getByText("Subdivisions", { exact: true }).waitFor();
    await hud.locator("[role=spinbutton]").first().dblclick();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("6", { delay: 120 });
    await page.keyboard.press("Enter");
    await app.settled();
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
    await node("NodeGroupOutput").waitFor();
    await r.pause(1200);
  });
  // The editor is maximized (Ctrl Space) while nodes are added, and restored to show the result.
  const maximize = async () => {
    await app.locator(EDITOR).hover();
    await r.keys("Ctrl Space", "Control+Space");
  };
  await app.hover();
  await r.keys("Numpad .", "NumpadDecimal");
  await r.gif("terrain", undefined, async () => {
    await maximize();
    await add("Set Position", 0.437, 0.452);
    await link("NodeGroupInput", "Socket", "GeometryNodeSetPosition", "Geometry");
    await link("GeometryNodeSetPosition", "Geometry", "NodeGroupOutput", "Socket");
    await add("Noise Texture", 0.08, 0.646);
    await add("Math Multiply", 0.2, 0.646);
    await add("Vector Math Scale", 0.32, 0.646);
    await add("Normal", 0.2, 0.894);
    await link("ShaderNodeTexNoise", "Fac", "ShaderNodeMath", "Value");
    await r.field(node("ShaderNodeMath"), "Value", 0.25);
    await link("ShaderNodeMath", "Value", "ShaderNodeVectorMath", "Scale");
    await link("GeometryNodeInputNormal", "Normal", "ShaderNodeVectorMath", "Vector");
    await link("ShaderNodeVectorMath", "Vector", "GeometryNodeSetPosition", "Offset");
    await maximize();
    await r.pause(2500);
  });
  await r.gif("forest", undefined, async () => {
    await maximize();
    const output = await node("NodeGroupOutput").boundingBox();
    const [x, y] = [output.x + output.width / 2, output.y + 10];
    const editor = await app.locator(EDITOR).boundingBox();
    await r.drag([x, y], [editor.x + editor.width * 0.95, y]);
    await add("Distribute Points on Faces", 0.52, 0.08);
    await add("Instance on Points", 0.72, 0.05);
    await add("Cone", 0.58, 0.6);
    await add("Join Geometry", 0.8, 0.5);
    await link("GeometryNodeSetPosition", "Geometry", "GeometryNodeDistributePointsOnFaces", "Mesh");
    await r.field(node("GeometryNodeDistributePointsOnFaces"), "Density", 40);
    await link("GeometryNodeDistributePointsOnFaces", "Points", "GeometryNodeInstanceOnPoints", "Points");
    await link("GeometryNodeDistributePointsOnFaces", "Rotation", "GeometryNodeInstanceOnPoints", "Rotation");
    await r.field(node("GeometryNodeMeshCone"), "Radius Bottom", 0.04);
    await r.field(node("GeometryNodeMeshCone"), "Depth", 0.1);
    await link("GeometryNodeMeshCone", "Mesh", "GeometryNodeInstanceOnPoints", "Instance");
    await link("GeometryNodeInstanceOnPoints", "Instances", "GeometryNodeJoinGeometry", "Geometry");
    await link("GeometryNodeSetPosition", "Geometry", "GeometryNodeJoinGeometry", "Geometry");
    await link("GeometryNodeJoinGeometry", "Geometry", "NodeGroupOutput", "Socket");
    await maximize();
    await r.pause(2500);
  });
  await r.gif("input", undefined, async () => {
    await maximize();
    await link("NodeGroupInput", "__extend__", "ShaderNodeTexNoise", "Scale");
    await maximize();
    await r.field(app.locator(".bl-properties-region"), "Scale", 2);
    await r.pause(2500);
  });
});

await record("geometry-nodes", { example: "geometry-nodes", node: "Planet" }, async (r) => {
  const { app, page } = r;
  await page.click('[data-workspace="geometry-nodes"]');
  await app.settled();
  await app.locator(EDITOR).hover();
  await r.keys("Ctrl Space", "Control+Space");
  await r.keys("Home");
  await r.pause(1000);
  await r.shot("planet-tree", EDITOR);
  await r.keys("Ctrl Space", "Control+Space");
  await page.click('[data-workspace="layout"]');
  await app.settled();
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await r.keys("Home");
  await app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
  await page.mouse.move(1, 1);
  await r.pause(20000);
  await r.shot("thumbnail", VIEW, { part: [0.12, 0.09, 0.96, 1] });
});
