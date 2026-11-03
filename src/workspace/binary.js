// A project's binary data, kept as bytes: a binary value is { blobId: id, content: Blob } (a binary file, a saved scene's
// .blend). Stored, it is JSON without its content plus the bytes under its id; in text (a share link) its content is
// base64, as projects saved before stored every binary value.
export const binaryValue = (bytes, blobId = crypto.randomUUID()) => ({ blobId, content: bytes instanceof Blob ? bytes : new Blob([bytes]) });

export function toBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function fromBase64(text) {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export const bytesOf = async (value) => (typeof value === "string" ? fromBase64(value) : new Uint8Array(await (value.content ?? value).arrayBuffer()));

// JSON of a value without its binary contents, and those contents by id.
export function splitBinary(value, space) {
  const blobs = new Map();
  const json = JSON.stringify(value, function (key, item) {
    if (!(item instanceof Blob)) return item;
    blobs.set(this.blobId, item);
    return undefined;
  }, space);
  return { json, blobs };
}

const holders = (value, found = []) => {
  if (!value || typeof value !== "object" || value instanceof Blob || ArrayBuffer.isView(value)) return found;
  if (typeof value.blobId === "string" || (value.kind === "binary" && typeof value.content === "string")) found.push(value);
  for (const item of Object.values(value)) holders(item, found);
  return found;
};
// Gives every binary value in a value its bytes: base64 content (old projects, share links) decoded, a missing one read
// by its id.
export async function joinBinary(value, read) {
  for (const holder of holders(value)) {
    holder.blobId ??= crypto.randomUUID();
    if (typeof holder.content === "string") holder.content = new Blob([fromBase64(holder.content)]);
    else if (!(holder.content instanceof Blob)) holder.content = await read(holder.blobId);
  }
  return value;
}
// A copy of a value with its binary contents in base64, for a format that is text.
export async function textBinary(value) {
  const copy = structuredClone(value);
  for (const holder of holders(copy)) if (holder.content instanceof Blob) holder.content = toBase64(await bytesOf(holder));
  return copy;
}
