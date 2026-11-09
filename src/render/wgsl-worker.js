// Converts effects' GLSL stages to WGSL off the main thread (glsl-to-wgsl.js). { init: { glslang, twgsl } } (the
// compilers' script and wasm URLs), then { id, source, stage } answered with { id, wgsl } or { id, error }.
import { glslToWGSL } from './glsl-to-wgsl.js';

let compilers;

// Babylon's compiler builds are scripts that define a global loader; run as such, outside this module's strict scope.
async function load({ js, wasm }, name) {
  (0, eval)(await (await fetch(js)).text());
  return self[name](wasm);
}

async function convert(source, stage) {
  // glslang writes its errors to the console: they are the error.
  const ready = await compilers, log = [], warn = console.warn;
  console.warn = (...line) => log.push(line.join(' '));
  try { return glslToWGSL(ready, source, stage); }
  catch (error) { throw Error([...log, error?.message ?? error].join(String.fromCharCode(10))); }
  finally { console.warn = warn; }
}

self.onmessage = async ({ data }) => {
  if (data.init) {
    compilers = Promise.all([load(data.init.glslang, 'glslang'), load(data.init.twgsl, 'twgsl')]).then(([glslang, twgsl]) => ({ glslang, twgsl }));
    return;
  }
  try { self.postMessage({ id: data.id, wgsl: await convert(data.source, data.stage) }); }
  catch (error) { self.postMessage({ id: data.id, error: String(error?.message ?? error) }); }
};
