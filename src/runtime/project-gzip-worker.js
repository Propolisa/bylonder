// A project's .blend gzipped, as project-state.js saves it, off the page's thread.
import { blendValue } from './project-gzip.js';

self.onmessage = ({ data: { id, bytes } }) => self.postMessage({ id, blend: blendValue(bytes) });
