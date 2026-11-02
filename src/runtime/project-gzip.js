// A saved .blend's text: gzipped without gzip's time stamp, so the same scene saves as the same text, in base64.
import { gzipSync, gunzipSync } from 'fflate';

const toBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
};
export const gzipBase64 = (bytes) => toBase64(gzipSync(bytes, { mtime: 0 }));
export const gunzipBase64 = (text) => gunzipSync(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
