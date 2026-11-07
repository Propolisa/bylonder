# Replays input events in Blender and saves a screenshot after each step, for side-by-side.mjs: the events Bylonder
# received for the same steps (window pixels from the top left, keys as Blender's event types).
#   blender --factory-startup --enable-event-simulate START.blend --python steps.py -- EVENTS.json OUT_DIR
import json
import os
import sys

import bpy

events_file, out = sys.argv[sys.argv.index("--") + 1:][:2]
steps = json.load(open(events_file))
bpy.context.preferences.view.show_tooltips = False
view = bpy.context.preferences.view
view.ui_scale *= 72 / bpy.context.preferences.system.dpi
TEXT = {"MINUS": "-", "PERIOD": ".", "ZERO": "0", "ONE": "1", "TWO": "2", "THREE": "3", "FOUR": "4", "FIVE": "5",
        "SIX": "6", "SEVEN": "7", "EIGHT": "8", "NINE": "9"}


def window():
    return bpy.context.window_manager.windows[0]


def send(event):
    w = window()
    x, y = event.get("x", 0), w.height - event.get("y", 0)
    modifiers = {m: True for m in event.get("modifiers", [])}
    if event["type"] == "MOUSEMOVE":
        w.event_simulate(type="MOUSEMOVE", value="NOTHING", x=x, y=y)
        return
    w.event_simulate(type="MOUSEMOVE", value="NOTHING", x=x, y=y)
    for value in event.get("values", ["PRESS", "RELEASE"]):
        unicode = {"unicode": TEXT.get(event["type"], event["type"].lower() if len(event["type"]) == 1 else "")} if value == "PRESS" and not modifiers else {}
        w.event_simulate(type=event["type"], value=value, x=x, y=y, **modifiers, **{k: v for k, v in unicode.items() if v})


def run():
    # A .blend to compare opens without its saved UI (Load UI off), as Bylonder opens one, and no splash.
    if os.environ.get("SIDE_BY_SIDE_FILE"):
        bpy.ops.wm.open_mainfile(filepath=os.environ["SIDE_BY_SIDE_FILE"], load_ui=False)
        yield 3.0
    for i, step in enumerate(steps):
        for event in step["events"]:
            send(event)
            yield 0.15
        yield step.get("settle", 1.0)
        for a in window().screen.areas:
            a.tag_redraw()
        yield 0.4
        # Save Screenshot writes in the scene's output format: a file's own (a video, say) would write no PNG.
        image = window().scene.render.image_settings
        image.media_type, image.file_format = "IMAGE", "PNG"
        with bpy.context.temp_override(window=window()):
            bpy.ops.screen.screenshot(filepath=os.path.join(out, f"{i:02d}.png"))
        print("shot", i, flush=True)
    bpy.ops.wm.quit_blender()


queue = run()
bpy.app.timers.register(lambda: next(queue, None), first_interval=2.0, persistent=True)
