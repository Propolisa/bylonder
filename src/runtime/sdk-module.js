// The `@workbench/sdk` module that project code imports: the running project's SDK, from globalThis.workbench.
const methods = ["controls", "editable", "asset", "onDispose", "meshTools", "animate", "renderSettings", "openBlend"];
const members = ["createText", "createPrimitive", "createMesh", "shadeSmooth", "updateText", "textSchema", "animation", "addModifier", "curve", "registerModifier", "registerPropertiesContext", "registerPropertiesPanel"];
export const sdkModuleSource = "export const BABYLON=globalThis.BABYLON,engine=globalThis.engine,canvas=globalThis.canvas,workbench=globalThis.workbench;export const " +
  [...methods.map((name) => `${name}=workbench.${name}.bind(workbench)`), ...members.map((name) => `${name}=workbench.${name}`)].join(",") + ";";
