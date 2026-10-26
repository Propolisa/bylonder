import { zipSync } from 'fflate';

// Writes rendered frames to a file. Video goes through WebCodecs, muxed by mediabunny (MPL-2.0, used
// unmodified as a dependency); images through canvas encoding. An animation in an image format becomes a ZIP
// of numbered frames, as Blender writes one file per frame.
//   spec: outputSpec(render) from formats.js; size: even dimensions for video
//   audio: { samples: Float32Array[] per channel, sampleRate } mixed by the sequencer, for video formats
export async function createWriter(spec, { width, height, fps, name, frames = 1, audio = null }) {
  if (spec.kind === 'image') {
    const files = {};
    const encode = async (canvas) => new Uint8Array(await (await canvas.convertToBlob({ type: spec.mime, quality: spec.quality })).arrayBuffer());
    return {
      async add(canvas, frame) { files[`${name}${String(frame).padStart(4, '0')}.${spec.ext}`] = await encode(canvas); },
      async finish() {
        const entries = Object.entries(files);
        if (frames === 1 && entries.length === 1) return { blob: new Blob([entries[0][1]], { type: spec.mime }), filename: entries[0][0] };
        return { blob: new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), filename: name + '.zip' };
      },
      cancel() {},
    };
  }
  const mb = await import('mediabunny');
  const format = { MPEG4: () => new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), QUICKTIME: () => new mb.MovOutputFormat({ fastStart: 'in-memory' }), MKV: () => new mb.MkvOutputFormat(), WEBM: () => new mb.WebMOutputFormat() }[spec.container]();
  const bitrate = mb[spec.quality];
  if (!(await mb.canEncodeVideo(spec.codec, { width, height, bitrate }))) throw Error(`This browser cannot encode ${spec.codec.toUpperCase()} at ${width} x ${height}. Pick another codec in Properties > Output > Encoding.`);
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format, target });
  const source = new mb.VideoSampleSource({ codec: spec.codec, bitrate, keyFrameInterval: Math.max(1, spec.gopsize) / fps, sizeChangeBehavior: 'deny' });
  output.addVideoTrack(source, { frameRate: fps });
  const sound = audio && await audioTrack(mb, output, spec, audio);
  await output.start();
  await sound?.();
  let index = 0;
  return {
    // The frame is consumed: callers must not use it afterwards.
    async add(videoFrame) {
      const sample = new mb.VideoSample(videoFrame, { timestamp: index / fps, duration: 1 / fps });
      index++;
      try { await source.add(sample); } finally { sample.close(); videoFrame.close(); }
    },
    async finish() {
      await output.finalize();
      return { blob: new Blob([target.buffer], { type: spec.mime }), filename: `${name}.${spec.ext}` };
    },
    async cancel() { await output.cancel().catch(() => {}); },
  };
}

// Adds the sequencer's mixed audio; skipped when the browser cannot encode the container's audio codec.
async function audioTrack(mb, output, spec, { samples, sampleRate }) {
  const codec = spec.container === 'WEBM' ? 'opus' : 'aac';
  if (!samples.length || !(await mb.canEncodeAudio(codec, { numberOfChannels: samples.length, sampleRate }))) return null;
  const source = new mb.AudioBufferSource({ codec, bitrate: mb.QUALITY_HIGH });
  output.addAudioTrack(source);
  const buffer = new AudioBuffer({ length: samples[0].length, numberOfChannels: samples.length, sampleRate });
  samples.forEach((channel, i) => buffer.copyToChannel(channel, i));
  return () => source.add(buffer);
}
