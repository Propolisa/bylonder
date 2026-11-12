# Writes tests/fixtures/sound-strips.blend: a scene at 24 fps whose sequencer holds two sound strips of one generated
# tone (a 440 Hz sine, 1 s, mono 16-bit WAV, packed into the file): "Tone" on channel 1 from frame 13, and "Tone Quiet"
# on channel 2 from frame 37, its first 6 frames cut off, at volume 0.5 and muted.
# usage: blender -b --factory-startup --python tools/blender-reference/sound-strips-fixture.py -- OUT_FILE
import bpy, math, os, struct, sys, tempfile, wave

out = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
tone = os.path.join(tempfile.mkdtemp(), "tone.wav")
with wave.open(tone, "wb") as f:
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(22050)
    f.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / 22050))) for i in range(22050)))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps, scene.frame_start, scene.frame_end = 24, 1, 72
strips = scene.sequence_editor_create().strips
loud = strips.new_sound("Tone", tone, 1, 13)
quiet = strips.new_sound("Tone Quiet", tone, 2, 37)
quiet.frame_offset_start, quiet.volume, quiet.mute = 6, 0.5, True
for sound in bpy.data.sounds:
    sound.pack()
    sound.filepath = "//tone.wav"
bpy.ops.wm.save_as_mainfile(filepath=out)
