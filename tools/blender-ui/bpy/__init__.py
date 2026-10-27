# Bylonder's bpy for Blender's UI scripts, as Transcrypt compiles them: the names they import. What they read at draw
# time (context, layout) comes from JS (src/editors/interface/ui-layout.js); bpy.data and other state from bpy._app.
from bpy import app, types, utils, path, _app

data = _app.data
context = _app.context
