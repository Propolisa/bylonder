from bpy import _app
# bpy.utils: Bylonder's application templates (its examples) are listed in one path, which os.listdir reads.
def app_template_paths():
    return ['APP_TEMPLATES']


# SMPTE timecode of a frame at the scene's rate, as bpy.utils.smpte_from_frame gives it.
def smpte_from_frame(frame, fps=None, fps_base=None):
    fps = fps or _app.context.scene.render.fps
    total = abs(int(frame))
    sign = '-' if frame < 0 else ''
    return '{}{:02d}:{:02d}:{:02d}:{:02d}'.format(sign, total // (3600 * fps), total // (60 * fps) % 60, total // fps % 60, total % fps)
