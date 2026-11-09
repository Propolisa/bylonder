// Images a serialized scene embeds as data URLs (a texture's base64String, the environment), written as files of the
// package instead (`images/<n>.<extension>`), so a page streams them and caches each once. Textures name their file,
// which Babylon's parsers read from the package's root URL.
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/vnd.radiance': 'hdr', 'application/octet-stream': 'env' };

function decoded(dataUrl) {
  const [, type, data] = /^data:([^;,]*)(?:;[^,]*)?,(.*)$/s.exec(dataUrl) ?? [];
  if (data === undefined) return null;
  return { type, bytes: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) };
}

// Every texture of `data` (the serialized scene) moved to a file; gives the files by path.
export function imageFiles(data) {
  const files = {}, byUrl = new Map();
  const file = (dataUrl) => {
    if (byUrl.has(dataUrl)) return byUrl.get(dataUrl);
    const image = decoded(dataUrl);
    if (!image) return null;
    const path = `images/${byUrl.size}.${EXTENSIONS[image.type] ?? 'bin'}`;
    files[path] = image.bytes;
    byUrl.set(dataUrl, path);
    return path;
  };
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.base64String === 'string' && value.base64String.startsWith('data:')) {
      const path = file(value.base64String);
      if (path) {
        delete value.base64String;
        Object.assign(value, { name: path, url: path });
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(data.materials);
  visit(data.multiMaterials);
  visit(data.particleSystems);
  if (typeof data.environmentTexture === 'string' && data.environmentTexture.startsWith('data:')) data.environmentTexture = file(data.environmentTexture) ?? data.environmentTexture;
  return files;
}
