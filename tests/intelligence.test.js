import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const bundle = JSON.parse(fs.readFileSync("public/babylon-types.json", "utf8"));
const ast = ts.createSourceFile(
  "intelligence.js",
  fs.readFileSync("src/workspace/intelligence.js", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
function constant(name) {
  for (const statement of ast.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (declaration.name.getText(ast) === name)
          return declaration.initializer.text;
  throw Error("Missing " + name);
}
const files = {
  ...bundle,
  "file:///node_modules/@workbench/sdk/index.d.ts": constant("sdk"),
  "file:///workspace/__globals.d.ts": constant("globals"),
  "file:///workspace/lib.js":
    'export function make(){return {height:42,color:"red"}}',
  "file:///__remote/example.d.ts":
    "export declare function remote(value: number): {score:number};",
  "file:///workspace/index.js": `import { make } from './lib.js';
import { remote } from 'https://example.com/module.js';
import {controls} from '@workbench/sdk';
const camera=new BABYLON.FreeCamera('a',BABYLON.Vector3.Zero(),new BABYLON.Scene(engine));
const value=remote(1).score;
const store=controls({id:'test',schema:{height:{default:1,min:0,max:3}},connect(store){store.effect(['height'],v=>{camera.position.y=v.height})}});
store.set('height',2);
make().height;
BABYLON.MeshBuilder.CreateSphere('s',{},new BABYLON.Scene(engine));
`,
};
const options = {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  skipLibCheck: true,
  baseUrl: "file:///workspace",
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  paths: {
    "@babylonjs/core": ["../node_modules/@babylonjs/core/index.d.ts"],
    "@workbench/sdk": ["../node_modules/@workbench/sdk/index.d.ts"],
    "https://example.com/module.js": ["../__remote/example.d.ts"],
  },
};
const host = {
  getScriptFileNames: () => Object.keys(files),
  getScriptVersion: () => "1",
  getScriptSnapshot: (name) => {
    const text = files[name] ?? ts.sys.readFile(name);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  getCurrentDirectory: () => "file:///workspace",
  getCompilationSettings: () => options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: (name) => name in files || ts.sys.fileExists(name),
  readFile: (name) => files[name] ?? ts.sys.readFile(name),
  readDirectory: ts.sys.readDirectory,
  directoryExists: (name) =>
    Object.keys(files).some((f) => f.startsWith(name + "/")) ||
    ts.sys.directoryExists(name),
};
const service = ts.createLanguageService(host);
const diagnostics = service.getSemanticDiagnostics(
  "file:///workspace/index.js",
);
assert.deepEqual(
  diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")),
  [],
);
const source = files["file:///workspace/index.js"];
const index =
  source.indexOf("BABYLON.MeshBuilder.CreateSphere") +
  "BABYLON.MeshBuilder.".length;
const completions = service.getCompletionsAtPosition(
  "file:///workspace/index.js",
  index,
  {},
);
assert(completions.entries.some((e) => e.name === "CreateSphere"));
const location = source.indexOf("remote(1)");
assert(
  service
    .getDefinitionAtPosition("file:///workspace/index.js", location)
    ?.some((d) => d.fileName === "file:///__remote/example.d.ts"),
);
console.log(
  "IntelliSense: full Babylon declarations, SDK generic store, local JS imports, HTTPS type paths, completions and Go to Definition passed",
);
