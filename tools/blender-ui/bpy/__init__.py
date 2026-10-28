# Bylonder's bpy for Blender's UI scripts, as Transcrypt compiles them: the names they import. What they read at draw
# time (context, layout) comes from JS (src/editors/interface/ui-layout.js); bpy.data and other state from bpy._app.
from bpy import app, utils, path, _app
from bpy import types as _types

data = _app.data
# bpy.types as the scripts read it at draw time: Blender's registered classes and RNA structs, filled from JS.
types = _app.types
# What the scripts read of bpy.types when they load.
types.Modifier = _types.Modifier
context = _app.context
