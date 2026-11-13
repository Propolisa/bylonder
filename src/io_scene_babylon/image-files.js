// Images a serialized scene embeds as data URLs (a texture's base64String, the environment), written as files of the
// package instead (`images/<n>.<extension>`), so a page streams them and caches each once. Textures name their file,
// which Babylon's parsers read from the package's root URL.
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/vnd.radiance': 'hdr', 'application/octet-stream': 'env' };

function decoded(dataUrl) {
  const [, type, data] = /^data:([^;,]*)(?:;[^,]*)?,(.*)$/s.exec(dataUrl) ?? [];
  if (data === undefined) return null;
  return { type, bytes: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) };
}

// A file's identity by its length and FNV-1a hash, so an image met again under another data URL is written once.
export function digest(bytes) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193);
  return `${bytes.length}:${hash >>> 0}`;
}

// Every texture of `data` (the serialized scene) moved to a file, named by its path and its content's version (so a
// cache never serves another export's image in its place); gives the files by path. With `files`, those made before
// (by an earlier call, for materials made since) are added to, numbered on.
export function imageFiles(data, files = {}) {
  const byUrl = new Map(), byBytes = new Map(Object.entries(files).map(([path, bytes]) => [digest(bytes), path]));
  const file = (dataUrl) => {
    if (byUrl.has(dataUrl)) return byUrl.get(dataUrl);
    const image = decoded(dataUrl);
    if (!image) return null;
    const same = byBytes.get(digest(image.bytes));
    if (same) { byUrl.set(dataUrl, same); return same; }
    const path = `images/${Object.keys(files).length}.${EXTENSIONS[image.type] ?? 'bin'}`;
    files[path] = image.bytes;
    byBytes.set(digest(image.bytes), path);
    byUrl.set(dataUrl, path);
    return path;
  };
  const versioned = (path) => path && `${path}?v=${digest(files[path]).replace(':', '.')}`;
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.base64String === 'string' && value.base64String.startsWith('data:')) {
      const path = versioned(file(value.base64String));
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
  if (typeof data.environmentTexture === 'string' && data.environmentTexture.startsWith('data:')) data.environmentTexture = versioned(file(data.environmentTexture)) ?? data.environmentTexture;
  return files;
}
