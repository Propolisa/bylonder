// ffmpeg and ffprobe for docs recordings and media checks, from the dev dependencies on every platform (FFMPEG and
// FFPROBE: others to use instead).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const ffmpeg = process.env.FFMPEG ?? require("ffmpeg-static");
export const ffprobe = process.env.FFPROBE ?? require("ffprobe-static").path;
