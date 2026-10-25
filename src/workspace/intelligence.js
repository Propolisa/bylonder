import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TSWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import JSONWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CSSWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HTMLWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (["javascript", "typescript"].includes(label)) return new TSWorker();
    if (label === "json") return new JSONWorker();
    if (label === "css") return new CSSWorker();
    if (label === "html") return new HTMLWorker();
    return new EditorWorker();
  },
};
export { monaco };
export const language = (path) =>
  ({
    js: "javascript",
    mjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    jsx: "javascript",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    glsl: "cpp",
  })[path.split(".").pop()] || "plaintext";
const defaults = [
  monaco.languages.typescript.javascriptDefaults,
  monaco.languages.typescript.typescriptDefaults,
];
const sdk = `import * as B from '@babylonjs/core';
export type Parameter<T=number|string|boolean>={default:T;label?:string;animatable?:boolean;min?:number;max?:number;step?:number;options?:Record<string,T>;validate?:(value:T)=>boolean};
export type Schema=Record<string,Parameter>;
export type Values<S extends Schema>={[K in keyof S]:S[K]['default']};
export interface Store<S extends Schema>{readonly values:Values<S>;readonly stale:boolean;ref(key:keyof S):string;set<K extends keyof S>(key:K,value:Values<S>[K]):boolean;subscribe(fn:(key:keyof S,value:Values<S>[keyof S])=>void):()=>void;effect(keys:(keyof S)[],fn:(values:Values<S>,context:{changed:string[]})=>void|(()=>void),options?:{mode?:'immediate'|'frame'|'debounce'|'manual';delay?:number;onStale?:(key:string)=>void}):()=>void;invalidate(key?:keyof S):void;flush():void;dispose():void}
/** Generate a UI section and independent reactive store from one schema. */
export function controls<S extends Schema>(definition:{id:string;title?:string;schema:S;connect?:(store:Store<S>)=>void|(()=>void)}):Store<S>;
/** Assign a stable identity to a mesh or transform node for interactive persistence. */
export function editable<T extends B.TransformNode>(node:T,options?:{id?:string}):T;
export function asset(path:string):string;
export function onDispose(cleanup:()=>void):void;
export const BABYLON:typeof B;
export const engine:B.Engine;
export const canvas:HTMLCanvasElement;
export interface TextOptions {text?:string;family?:string;weight?:number;italic?:boolean;size?:number;depth?:number;spacing?:number;lineHeight?:number;resolution?:number;align?:'left'|'center'|'right'}
export function createText(name:string,options:TextOptions,scene:B.Scene):Promise<B.Mesh>;
export function updateText(node:B.Mesh,options:TextOptions):Promise<B.Mesh>;
export const textSchema:Record<keyof TextOptions,Parameter>;
export function meshTools(config:{include?:string[];defaults?:Record<string,Record<string,number|boolean|string>>;fields?:Record<string,Record<string,Parameter>>}):void;
export type DataRef = string;
export type Interpolation = 'BEZIER'|'LINEAR'|'CONSTANT';
export interface AnimationKey {frame:number;value:number|string|boolean;interpolation:Interpolation}
export interface AnimationTrack {id:string;path:string;keys:AnimationKey[];muted?:boolean}
export interface SceneTime {frameCurrent:number;frameStart:number;frameEnd:number;frameStep:number;fps:number;usePreviewRange:boolean;framePreviewStart:number;framePreviewEnd:number;autoKey:boolean;loop:boolean}
export interface Action {name:string;tracks:AnimationTrack[];/** @deprecated use animation.time */readonly start:number;/** @deprecated */readonly end:number;/** @deprecated */readonly fps:number;/** @deprecated */readonly frame:number;/** @deprecated */readonly loop:boolean;/** @deprecated */readonly autoKey:boolean}
export interface AnimationData {version:2;action:{name:string;tracks:AnimationTrack[]};time:SceneTime}
export const animation:{ref(id:string,path:string):DataRef;readonly action:Action;readonly time:{readonly state:SceneTime;readonly frame:number;readonly playing:boolean;range():[number,number];configure(patch:Partial<SceneTime>):void;seek(frame:number):void};readonly playing:boolean;insert(refs:DataRef|DataRef[],frame?:number,value?:number|string|boolean):void;seek(frame:number):void;play():void;pause():void;configure(patch:{name?:string;start?:number;end?:number;fps?:number;frame?:number;loop?:boolean;autoKey?:boolean}):void;serialize():AnimationData;load(data:AnimationData):void;clear(refs:DataRef|DataRef[]):void;deleteKeys(keys:{ref:DataRef;frame:number}[]):void;editKeys(keys:{ref:DataRef;frame:number}[],options:{offset?:number;duplicate?:boolean;interpolation?:Interpolation}):void;toAnimationGroup(scene:B.Scene,name?:string):B.AnimationGroup};
export function animate<T extends object>(target:T,definition:{id:string;title?:string;properties:Record<string,Partial<Parameter>>}):{id:string;title:string;schema:Schema;target:T;ref(path:string):DataRef};
export interface Modifier {id:string;type:string;name:string;showViewport:boolean;showRender:boolean;values:Record<string,number|string|boolean>}
export function addModifier(node:B.Mesh,type?:'ARRAY'|string,values?:Record<string,number|string|boolean>):Modifier;
export function curve<T extends B.TransformNode>(node:T,points:B.Curve3|B.Vector3[]|number[][]|{points:number[][];closed?:boolean}[],options?:{closed?:boolean}):T;
export function registerModifier(definition:{id:string;name:string;category:string;icon:string;schema:Schema;defaults:()=>Record<string,number|string|boolean>;evaluate:(input:{data:object;matrices:B.Matrix[]},modifier:Modifier,context:object)=>{data:object;matrices:B.Matrix[]}}):void;
export function registerPropertiesContext(context:{id:string;title:string;icon:string;color:string}):void;
export function registerPropertiesPanel(panel:{id:string;context:string;title:string;poll?:(context:any)=>boolean;render:(context:any)=>any}):void;
export const workbench:{addModifier:typeof addModifier;curve:typeof curve;registerModifier:typeof registerModifier;registerPropertiesContext:typeof registerPropertiesContext;registerPropertiesPanel:typeof registerPropertiesPanel;animation:typeof animation;animate:typeof animate;createText:typeof createText;updateText:typeof updateText;textSchema:typeof textSchema;meshTools:typeof meshTools;meshBuilders:Record<string,{parameters:string[];fields:Record<string,{type:string;required:boolean}>}>;controls:typeof controls;editable:typeof editable;asset:typeof asset;onDispose:typeof onDispose};
`;
const globals = `import * as B from '@babylonjs/core';import {workbench as sdk} from '@workbench/sdk';declare global {const BABYLON:typeof B;const engine:B.Engine;const canvas:HTMLCanvasElement;const workbench:typeof sdk;}export {};`;
const extra = (source, path) =>
  defaults.map((d) => d.addExtraLib(source, path));
export function importSpecifiers(source) {
  const result = new Set();
  const regex =
    /(?:\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(regex)) result.add(match[1]);
  return [...result];
}
export async function setupIntelligence(onStatus) {
  onStatus("Loading Babylon declarations…");
  const response = await fetch(import.meta.env.BASE_URL + "babylon-types.json");
  if (!response.ok) throw Error("Babylon type bundle unavailable");
  const bundle = await response.json();
  for (const [uri, content] of Object.entries(bundle)) extra(content, uri);
  extra(sdk, "file:///node_modules/@workbench/sdk/index.d.ts");
  extra(globals, "file:///workspace/__globals.d.ts");
  extra(
    'declare module "*?raw" { const source:string;export default source } declare module "*.css?module" {const style:HTMLStyleElement;export default style}',
    "file:///workspace/__assets.d.ts",
  );
  const basePaths = {
    "@babylonjs/core": ["../node_modules/@babylonjs/core/index.d.ts"],
    "@babylonjs/core/*": ["../node_modules/@babylonjs/core/*"],
    babylonjs: ["../node_modules/@babylonjs/core/index.d.ts"],
    "@workbench/sdk": ["../node_modules/@workbench/sdk/index.d.ts"],
  };
  let generation = 0,
    remoteDisposers = [],
    controller;
  const configure = (paths) =>
    defaults.forEach((d) => {
      d.setCompilerOptions({
        allowJs: true,
        checkJs: true,
        allowNonTsExtensions: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        strict: false,
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution:
          monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        jsx: monaco.languages.typescript.JsxEmit.React,
        baseUrl: "file:///workspace",
        paths: { ...basePaths, ...paths },
      });
      d.setEagerModelSync(true);
      d.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });
    });
  configure({});
  onStatus("Babylon + SDK types ready");
  const acquire = async (project) => {
    const job = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    let importmap = {},
      overrides = {};
    try {
      importmap =
        JSON.parse(project.files["importmap.json"]?.content || "{}").imports ||
        {};
      overrides =
        JSON.parse(project.files["types.json"]?.content || "{}").imports || {};
    } catch (e) {
      onStatus("Invalid importmap.json or types.json");
      return;
    }
    const paths = {},
      loaded = new Map(),
      seen = new Map(),
      issues = [];
    let count = 0,
      inferred = 0;
    const virtual = (url) =>
      "file:///__remote/" +
      Array.from(new TextEncoder().encode(url), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("") +
      (/\.d\.[mc]?ts(?:\?|$)/.test(url) ? ".d.ts" : ".js");
    const fetchText = async (url) => {
      const cache = await caches.open("babylon-type-sources-v1");
      const cached = await cache.match(url);
      if (
        cached &&
        Date.now() - Number(cached.headers.get("x-wb-time")) < 3600000
      )
        return cached;
      const res = await fetch(url, { signal });
      if (!res.ok) throw Error(res.status + " " + url);
      const text = await res.text();
      const headers = new Headers(res.headers);
      headers.set("x-wb-time", String(Date.now()));
      headers.set("x-wb-url", res.url || url);
      const stored = new Response(text, { headers });
      await cache.put(url, stored.clone());
      return stored;
    };
    const resolve = async (url, preferDeclaration = true) => {
      if (seen.has(url)) return seen.get(url);
      const uri = virtual(url);
      seen.set(url, uri);
      if (++count > 1000)
        throw Error(
          "Declaration graph exceeded 1000 remote files; supply a bundled .d.ts via types.json.",
        );
      let res = await fetchText(url),
        body = await res.text(),
        final = res.headers.get("x-wb-url") || url;
      const header =
        res.headers.get("x-typescript-types") ||
        res.headers.get("x-deno-types") ||
        res.headers.get("link")?.match(/<([^>]+)>;\s*rel=["']?types/)?.[1];
      if (preferDeclaration && header && !/\.d\.[mc]?ts(?:\?|$)/.test(url)) {
        final = new URL(header, final).href;
        const target = await resolve(final, false);
        seen.set(url, target);
        return target;
      }
      if (
        preferDeclaration &&
        !/\.d\.[mc]?ts(?:\?|$)/.test(url) &&
        /\.[mc]?js(?:\?|$)/.test(final)
      ) {
        const candidate = final.replace(/\.[mc]?js(?=\?|$)/, ".d.ts");
        try {
          const types = await fetchText(candidate);
          if (
            !(types.headers.get("content-type") || "").includes("text/html")
          ) {
            final = candidate;
            body = await types.text();
          }
        } catch (e) {
          if (signal.aborted) throw e;
        }
      }
      if ((res.headers.get("content-type") || "").includes("text/html"))
        throw Error("Received HTML instead of module/types: " + url);
      const target = virtual(final);
      seen.set(url, target);
      seen.set(final, target);
      loaded.set(target, body);
      // Rewrite relative declaration imports to unique virtual package keys. TS paths
      // then resolves their complete graph, including HTTP specifiers and cycles.
      for (const spec of importSpecifiers(body)) {
        if (spec.startsWith("node:")) {
          issues.push(spec + " needs a browser replacement");
          continue;
        }
        if (basePaths[spec]) continue;
        let dependency;
        if (spec.startsWith(".") || spec.startsWith("/"))
          dependency = new URL(spec, final).href;
        else if (/^https?:/.test(spec)) dependency = spec;
        else
          dependency =
            overrides[spec] || importmap[spec] || "https://esm.sh/" + spec;
        if (!/^https?:/.test(dependency)) {
          continue;
        }
        if (/\.d\.[mc]?ts(?:\?|$)/.test(final) && /\.js$/.test(dependency))
          dependency = dependency.replace(/\.js$/, ".d.ts");
        if (
          /\.d\.[mc]?ts(?:\?|$)/.test(final) &&
          !/[.][a-z]+(?:\?|$)/i.test(new URL(dependency).pathname)
        )
          dependency += ".d.ts";
        try {
          const child = await resolve(dependency);
          const alias = "__remote/" + encodeURIComponent(dependency);
          paths[alias] = [child.replace("file:///", "../")];
          body = body
            .split(JSON.stringify(spec))
            .join(JSON.stringify(alias))
            .split("'" + spec + "'")
            .join(JSON.stringify(alias));
        } catch (e) {
          if (signal.aborted) throw e;
          issues.push(spec + ": " + e.message);
        }
      }
      loaded.set(target, body);
      if (!/\.d\.[mc]?ts(?:\?|$)/.test(final)) inferred++;
      return target;
    };
    const specs = new Set(
      Object.values(project.files)
        .filter((f) => f.kind === "text")
        .flatMap((f) => importSpecifiers(f.content)),
    );
    for (const spec of specs) {
      if (
        spec.startsWith(".") ||
        spec.startsWith("/") ||
        basePaths[spec] ||
        spec.startsWith("@babylonjs/core/")
      )
        continue;
      let source =
        overrides[spec] ||
        importmap[spec] ||
        (/^https?:/.test(spec) ? spec : null);
      if (!source) {
        const prefix = Object.keys(importmap).find(
          (k) => k.endsWith("/") && spec.startsWith(k),
        );
        if (prefix) source = importmap[prefix] + spec.slice(prefix.length);
      }
      if (!source) {
        issues.push(spec + ": add an importmap.json mapping");
        continue;
      }
      if (source.startsWith(".")) {
        paths[spec] = [source];
        continue;
      }
      if (!/^https?:/.test(source)) {
        issues.push(spec + ": unsupported type URL");
        continue;
      }
      try {
        onStatus("Resolving types: " + spec);
        const uri = await resolve(source);
        paths[spec] = [uri.replace("file:///", "../")];
      } catch (e) {
        if (signal.aborted) return;
        issues.push(spec + ": " + e.message);
      }
    }
    if (job !== generation) return;
    remoteDisposers.forEach((d) => d.dispose());
    remoteDisposers = [];
    for (const [uri, body] of loaded) remoteDisposers.push(...extra(body, uri));
    configure(paths);
    onStatus(
      issues.length
        ? issues.join("\n")
        : `Types ready · Babylon + SDK · ${loaded.size} remote modules (${inferred} JS-inferred)`,
    );
    return { paths, loaded, issues };
  };
  return {
    acquire,
    dispose() {
      controller?.abort();
      remoteDisposers.forEach((d) => d.dispose());
    },
  };
}
