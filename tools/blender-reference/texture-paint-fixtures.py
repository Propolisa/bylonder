# Texture Paint and Vertex Paint on a plane facing the view, with real input, for tests/texture-paint-wasm.test.js: a
# 4 x 4 grid unwrapped by UV > Unwrap and by Smart UV Project, then a Base Color paint slot added (a 64 x 64 black image)
# and a white left drag across it in Texture Paint Mode; then a Color attribute added and a white drag in Vertex Paint
# Mode. After each, the UVs, the image's pixels or the attribute's colors. Events are in region pixels.
# Run inside an X server, with event simulation:
#   blender --factory-startup --enable-event-simulate --python texture-paint-fixtures.py -- OUT.json
import json
import sys

import bpy
from bpy_extras.view3d_utils import location_3d_to_region_2d
from mathutils import Quaternion, Vector

out = sys.argv[sys.argv.index("--") + 1]
VIEW = {"rotation": (0.7071068, 0.7071068, 0, 0), "location": (0, 0, 0), "distance": 3.0}
SIZE = 64


def window():
    return bpy.context.window_manager.windows[0]


def view3d():
    area = next(a for a in window().screen.areas if a.type == "VIEW_3D")
    return area, next(r for r in area.regions if r.type == "WINDOW")


def flat(matrix):
    return [matrix[r][c] for c in range(4) for r in range(4)]


def uvs(mesh):
    return [round(v, 4) for loop in mesh.uv_layers.active.data for v in loop.uv]


def steps():
    area, region = view3d()
    rv3d = area.spaces.active.region_3d
    with bpy.context.temp_override(window=window(), area=area, region=region):
        for ob in list(bpy.data.objects):
            bpy.data.objects.remove(ob)
        bpy.ops.mesh.primitive_grid_add(x_subdivisions=4, y_subdivisions=4, size=2, rotation=(1.5707963, 0, 0))
        grid = bpy.context.object
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="CONFORMAL", margin=0.0)
        unwrap = uvs_after_edit(grid)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.uv.smart_project(island_margin=0.0)
        smart = uvs_after_edit(grid)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.uv.unwrap(method="CONFORMAL", margin=0.0)
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.paint.texture_paint_toggle()
        bpy.ops.paint.add_texture_paint_slot(type="BASE_COLOR", slot_type="IMAGE", name="Paint", color=(0, 0, 0, 1), width=SIZE, height=SIZE)
    rv3d.view_perspective = "ORTHO"
    rv3d.view_rotation = Quaternion(VIEW["rotation"]).normalized()
    rv3d.view_distance = VIEW["distance"]
    rv3d.view_location = VIEW["location"]
    settings = bpy.context.scene.tool_settings
    settings.image_paint.unified_paint_settings.color = (1, 1, 1)
    yield 0.5

    def at(x, z):
        return [round(c) for c in location_3d_to_region_2d(region, rv3d, Vector((x, 0, z)))]

    a, b = at(-0.7, 0.1), at(0.7, 0.1)
    drag = [[a[0] + (b[0] - a[0]) * i // 10, a[1]] for i in range(11)]
    stroke = [["MOUSEMOVE", "NOTHING", *drag[0]], ["LEFTMOUSE", "PRESS", *drag[0]]] + [["MOUSEMOVE", "NOTHING", *p] for p in drag[1:]] + \
        [["LEFTMOUSE", "RELEASE", *drag[-1]]]

    def send(events):
        for type, value, x, y in events:
            window().event_simulate(type=type, value=value, x=region.x + x, y=region.y + y)
            yield 0.1
        yield 0.5

    # A click off the grid first: the window takes the first click for its focus.
    yield from send([["MOUSEMOVE", "NOTHING", 10, 10], ["LEFTMOUSE", "PRESS", 10, 10], ["LEFTMOUSE", "RELEASE", 10, 10]])
    image = bpy.data.images["Paint"]
    yield from send(stroke)
    pixels = [round(v, 3) for v in image.pixels]
    image_brush = settings.image_paint.brush
    with bpy.context.temp_override(window=window(), area=area, region=region):
        bpy.ops.object.mode_set(mode="OBJECT")
        grid.data.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
        grid.data.color_attributes.active_color = grid.data.color_attributes["Color"]
        for value in grid.data.color_attributes["Color"].data:
            value.color = (0, 0, 0, 1)
        bpy.ops.paint.vertex_paint_toggle()
    settings.vertex_paint.unified_paint_settings.color = (1, 1, 1)
    yield 0.5
    yield from send(stroke)
    colors = [round(v, 3) for value in grid.data.color_attributes["Color"].data for v in value.color]
    vertex_brush = settings.vertex_paint.brush
    result = {"view": {"viewmat": flat(rv3d.view_matrix), "winmat": flat(rv3d.window_matrix), "winx": region.width,
                       "winy": region.height, "persp": rv3d.is_perspective},
              "image_brush": {"name": image_brush.name, "strength": image_brush.strength, "size": image_brush.size},
              "vertex_brush": {"name": vertex_brush.name, "strength": vertex_brush.strength, "size": vertex_brush.size},
              "unwrap": unwrap, "smart_project": smart, "stroke": stroke, "size": SIZE, "pixels": pixels, "colors": colors}
    with open(out, "w") as file:
        json.dump(result, file)
    print("fixture done", flush=True)
    bpy.ops.wm.quit_blender()


def uvs_after_edit(ob):
    bpy.ops.object.mode_set(mode="OBJECT")
    return uvs(ob.data)


queue = steps()
bpy.app.timers.register(lambda: next(queue, None), first_interval=2.0, persistent=True)
