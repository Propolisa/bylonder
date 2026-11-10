// The sources of @babylonjs/core's modules a bundled package is made from (bundle.js): one archive the app serves from its
// own origin (vite.config.js babylonSources), fetched on the first bundled export and kept in the browser's Cache Storage,
// so later exports bundle offline. Babylon's licence text is in it as license.md.

/** The archive's file name, beside the app's pages. */
export const babylonArchive = (version) => `babylon-core-${version}.zip`;

async function archive(url) {
  const cache = await globalThis.caches?.open('bylonder-export').catch(() => null);
  const cached = await cache?.match(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw Error(`Babylon's sources for the bundle: ${url} answered ${response.status}`);
  await cache?.put(url, response.clone()).catch(() => {});
  return response;
}

/** The text of @babylonjs/core `version`'s file at a path (`Engines/engine.js`), as the app serves it. */
export async function babylonSources(version, base = document.baseURI) {
  const { strFromU8, unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(await (await archive(new URL(babylonArchive(version), base).href)).arrayBuffer()));
  return (path) => {
    if (!files[path]) throw Error(`@babylonjs/core ${version} has no ${path}`);
    return strFromU8(files[path]);
  };
}
