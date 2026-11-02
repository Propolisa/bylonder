// A project's .blend gzipped and in base64, as project-state.js saves it, off the page's thread.
import { gzipBase64 } from './project-gzip.js';

self.onmessage = ({ data: { id, bytes } }) => self.postMessage({ id, text: gzipBase64(bytes) });
