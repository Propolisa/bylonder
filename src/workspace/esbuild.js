// esbuild in the browser, its WebAssembly from the app's own origin, started once per page on first use.
let service;
export const esbuildService = () => (service ??= (async () => {
  const [esbuild, wasm] = await Promise.all([import("esbuild-wasm"), import("esbuild-wasm/esbuild.wasm?url")]);
  await esbuild.initialize({ wasmURL: wasm.default });
  return esbuild;
})());
