import sys
import bpy

name = sys.argv[sys.argv.index("--") + 1]


def show():
    if name in bpy.data.workspaces:
        bpy.context.window_manager.windows[0].workspace = bpy.data.workspaces[name]
    else:
        bpy.ops.wm.read_homefile(app_template=name)


bpy.app.timers.register(show, first_interval=2)
