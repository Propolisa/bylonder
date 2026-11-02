// Blender's color management files (config.ocio, its LUTs, Filmic's data and the display ICC profiles), in the module's
// file system once fetched; what reads them waits for them, as the asset libraries' readers wait for the Essentials
// datafiles. Blender's config itself is in the module already: colormanagement_init parsed it when the module's
// snapshot was made.
// port-override: OpenImageIO's color config probes every color space of $OCIO's config on first use, and OpenColorIO
// throws where a file it needs is missing; the module has no C++ exceptions yet (platform.cc), so until it does the
// files are fetched only where Blender's own color management needs them, and OpenImageIO keeps its built-in config.
import { COLOR_MANAGEMENT } from '../bmesh/datafiles.js';
import { files, read } from '../port/wasm.js';

let fetched = null;
export const colorManagementFiles = () => (fetched ??= Promise.all(COLOR_MANAGEMENT.map(async ([name, url]) =>
  files.set(`/blender/datafiles/${name}`, new Uint8Array(await read(url))))));
