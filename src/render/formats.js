// Output formats: Blender's scene.render.image_settings and scene.render.ffmpeg (their identifiers, the video ones
// defined by tools/blender-port/wasm/movie-api.cc), mapped to what the browser writes: still images through canvas
// encoding, video through WebCodecs (muxed by mediabunny).
export const fileFormats = {
  PNG: { label: 'PNG', mime: 'image/png', ext: 'png' },
  JPEG: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', quality: true },
  WEBP: { label: 'WebP', mime: 'image/webp', ext: 'webp', quality: true },
  FFMPEG: { label: 'Video', video: true },
};
// Blender's ffmpeg.format values; codecs are the subset each container accepts.
export const containers = {
  MPEG4: { label: 'MPEG-4', mime: 'video/mp4', ext: 'mp4', codecs: ['H264', 'H265', 'AV1', 'WEBM'] },
  QUICKTIME: { label: 'QuickTime', mime: 'video/quicktime', ext: 'mov', codecs: ['H264', 'H265', 'AV1', 'WEBM'] },
  MKV: { label: 'Matroska', mime: 'video/x-matroska', ext: 'mkv', codecs: ['H264', 'H265', 'AV1', 'WEBM'] },
  WEBM: { label: 'WebM', mime: 'video/webm', ext: 'webm', codecs: ['WEBM', 'AV1'] },
};
// Blender's ffmpeg.audio_codec values the browser encodes; the containers that hold them; audio_channels as counts.
const audioCodecs = { AAC: { label: 'AAC', id: 'aac', containers: ['MPEG4', 'QUICKTIME', 'MKV'] }, OPUS: { label: 'Opus', id: 'opus', containers: ['MPEG4', 'MKV', 'WEBM'] } };
const channelCounts = { MONO: 1, STEREO: 2, SURROUND4: 4, SURROUND51: 6, SURROUND71: 8 };
export const videoCodecs = { H264: { label: 'H.264', id: 'avc' }, H265: { label: 'H.265 / HEVC', id: 'hevc' }, AV1: { label: 'AV1', id: 'av1' }, WEBM: { label: 'VP9', id: 'vp9' } };
// Blender's Output Quality (constant_rate_factor) levels as mediabunny quality presets; Constant Bitrate uses the
// bitrate (kbit/s).
const qualities = { HIGH: 'QUALITY_VERY_HIGH', MEDIUM: 'QUALITY_HIGH', LOW: 'QUALITY_MEDIUM', VERYLOW: 'QUALITY_LOW', LOWEST: 'QUALITY_VERY_LOW' };

// A render job's output from Blender's scene.render; throws on what the browser cannot write.
export function outputSpec(render) {
  const settings = render.image_settings, format = fileFormats[settings.file_format];
  if (!format) throw Error(`The browser cannot write ${settings.file_format} files`);
  if (!format.video) return { kind: 'image', ...format, quality: settings.quality / 100 };
  const { ffmpeg } = render, container = containers[ffmpeg.format], codec = videoCodecs[ffmpeg.codec];
  if (!container || !codec) throw Error('Unknown video settings');
  if (!container.codecs.includes(ffmpeg.codec)) throw Error(`${container.label} cannot hold ${codec.label}`);
  const bitrate = ffmpeg.constant_rate_factor === 'NONE' ? ffmpeg.video_bitrate * 1000 : qualities[ffmpeg.constant_rate_factor];
  if (!bitrate) throw Error('Unknown output quality ' + ffmpeg.constant_rate_factor);
  return { kind: 'video', container: ffmpeg.format, mime: container.mime, ext: container.ext, codec: codec.id, bitrate,
    latencyMode: ffmpeg.ffmpeg_preset === 'REALTIME' ? 'realtime' : 'quality', gopsize: ffmpeg.gopsize, audio: audioSpec(ffmpeg, container) };
}
function audioSpec(ffmpeg, container) {
  if (ffmpeg.audio_codec === 'NONE') return null;
  const codec = audioCodecs[ffmpeg.audio_codec];
  if (!codec) throw Error('Unknown audio codec ' + ffmpeg.audio_codec);
  if (!codec.containers.includes(ffmpeg.format)) throw Error(`${container.label} cannot hold ${codec.label} audio`);
  return { codec: codec.id, bitrate: ffmpeg.audio_bitrate * 1000, channels: channelCounts[ffmpeg.audio_channels], rate: ffmpeg.audio_mixrate, volume: ffmpeg.audio_volume };
}
// Video encoders need even dimensions (4:2:0 chroma).
export const encodeSize = ({ width, height }, video) => (video ? { width: width + (width % 2), height: height + (height % 2) } : { width, height });
