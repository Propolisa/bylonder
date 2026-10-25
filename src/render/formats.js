// Output formats, named like Blender's image_settings.file_format and ffmpeg settings, mapped to what the
// browser writes: still images through canvas encoding, video through WebCodecs (muxed by mediabunny).
export const fileFormats = {
  PNG: { label: 'PNG', mime: 'image/png', ext: 'png' },
  JPEG: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', quality: true },
  WEBP: { label: 'WebP', mime: 'image/webp', ext: 'webp', quality: true },
  FFMPEG: { label: 'FFmpeg Video', video: true },
};
// Blender's ffmpeg.format values; codecs are the subset each container accepts.
export const containers = {
  MPEG4: { label: 'MPEG-4', mime: 'video/mp4', ext: 'mp4', codecs: ['H264', 'H265', 'AV1', 'VP9'] },
  QUICKTIME: { label: 'QuickTime', mime: 'video/quicktime', ext: 'mov', codecs: ['H264', 'H265', 'AV1', 'VP9'] },
  MKV: { label: 'Matroska', mime: 'video/x-matroska', ext: 'mkv', codecs: ['H264', 'H265', 'AV1', 'VP9', 'VP8'] },
  WEBM: { label: 'WebM', mime: 'video/webm', ext: 'webm', codecs: ['VP9', 'AV1', 'VP8'] },
};
export const videoCodecs = { H264: { label: 'H.264', id: 'avc' }, H265: { label: 'H.265 / HEVC', id: 'hevc' }, AV1: { label: 'AV1', id: 'av1' }, VP9: { label: 'VP9', id: 'vp9' }, VP8: { label: 'VP8', id: 'vp8' } };
// Blender's Output Quality (constant_rate_factor) levels, as mediabunny quality presets.
export const qualities = { HIGH: { label: 'High Quality', preset: 'QUALITY_VERY_HIGH' }, MEDIUM: { label: 'Medium Quality', preset: 'QUALITY_HIGH' }, LOW: { label: 'Low Quality', preset: 'QUALITY_MEDIUM' }, VERYLOW: { label: 'Very Low Quality', preset: 'QUALITY_LOW' }, LOWEST: { label: 'Lowest Quality', preset: 'QUALITY_VERY_LOW' } };

// Normalized output description for a render job; throws on combinations no browser can write.
export function outputSpec(render) {
  const format = fileFormats[render.imageSettings.fileFormat];
  if (!format) throw Error('Unknown file format: ' + render.imageSettings.fileFormat);
  if (!format.video) return { kind: 'image', ...format, quality: render.imageSettings.quality / 100 };
  const container = containers[render.ffmpeg.format], codec = videoCodecs[render.ffmpeg.codec], quality = qualities[render.ffmpeg.constantRateFactor];
  if (!container || !codec || !quality) throw Error('Unknown video settings');
  if (!container.codecs.includes(render.ffmpeg.codec)) throw Error(`${container.label} cannot hold ${codec.label}`);
  return { kind: 'video', container: render.ffmpeg.format, mime: container.mime, ext: container.ext, codec: codec.id, quality: quality.preset, gopsize: render.ffmpeg.gopsize };
}
// Video encoders need even dimensions (4:2:0 chroma).
export const encodeSize = ({ width, height }, video) => (video ? { width: width + (width % 2), height: height + (height % 2) } : { width, height });
