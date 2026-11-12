// A project's libraries (docs/blender-boundary.md, Link and Append): the .blend files Main links from are project files
// under libraries/, at /libraries/ in the module's file system, where Link and Append put the file the user chose. The
// project keeps every library Main lists; they are in the file system before the project's .blend is read, so Blender's
// reader resolves its links.
import { files } from '../port/wasm.js';
import { blendData } from '../python/bpy_rna.js';

export const LIBRARY_FOLDER = '/libraries';
const isLibrary = (path) => /^libraries\/[^/]+\.blend$/i.test(path);

// The project's library files (paths of the project) into the file system: read(path) gives a file's bytes.
export const loadLibraries = (paths, read) => Promise.all(paths.filter(isLibrary).map(async (path) => files.set(`/${path}`, await read(path))));

// Main's libraries the project does not keep yet (`kept`: paths of the project), as [path, bytes].
export const unkeptLibraries = (kept) => [...blendData().libraries]
  .map((library) => library.filepath.replace(/^\/+/, ''))
  .filter((path) => isLibrary(path) && !kept.has(path) && files.has(`/${path}`))
  .map((path) => [path, files.get(`/${path}`)]);
