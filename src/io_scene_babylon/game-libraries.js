// The sources of the libraries game code may import (game-export.js GAME_LIBRARIES), which an export inlines into
// game.js: one archive the app serves from its own origin (vite.config.js gameLibraries), fetched on the first export
// of a project with game code.
import { strFromU8, unzipSync } from 'fflate';

/** The archive's file name, beside the app's pages. */
export const GAME_LIBRARIES_ARCHIVE = 'game-libraries.zip';

let files = null;
/** A library's `{ version, license, notice, read(path) }` from the archive (`<package>/<path>` entries). */
export async function archivedLibrary(name) {
  files ??= (async () => {
    const response = await fetch(new URL(GAME_LIBRARIES_ARCHIVE, document.baseURI));
    if (!response.ok) throw Error(`The game libraries' sources: ${GAME_LIBRARIES_ARCHIVE} answered ${response.status}`);
    return unzipSync(new Uint8Array(await response.arrayBuffer()));
  })();
  const all = await files, file = (path) => all[`${name}/${path}`];
  const manifest = JSON.parse(strFromU8(file('package.json')));
  const notice = ['LICENSE.md', 'license.md', 'LICENSE'].map(file).find(Boolean);
  return {
    version: manifest.version, license: manifest.license, notice: notice ? strFromU8(notice) : manifest.license,
    read: async (path) => { const data = file(path); if (!data) throw Error(`${name}/${path} is not in ${GAME_LIBRARIES_ARCHIVE}`); return strFromU8(data); },
  };
}
