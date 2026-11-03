// A saved .blend's binary value: gzipped without gzip's time stamp, so the same scene saves as the same bytes.
import { gzipSync } from 'fflate';
import { binaryValue } from '../workspace/binary.js';

export const blendValue = (bytes) => binaryValue(gzipSync(bytes, { mtime: 0 }));
