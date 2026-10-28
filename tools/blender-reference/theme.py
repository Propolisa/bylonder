# Writes Blender's default theme (userdef_default_theme.c, as Preferences > Themes shows it) for the editors Bylonder
# draws itself (src/editors/interface/theme-default.json): each theme struct's colors as RGBA 0..1 and its numbers, by
# RNA identifier: the shared animation and curve colors (common), the regions, the editors and the widgets.
# usage: blender -b --factory-startup --python tools/blender-reference/theme.py -- OUT.json
import bpy, json, sys

out = sys.argv[sys.argv.index("--") + 1]
EDITORS = ["common", "regions", "graph_editor", "dopesheet_editor", "user_interface", "text_editor", "console", "info"]


def struct(data):
    result = {}
    for prop in data.bl_rna.properties:
        if prop.identifier == "rna_type":
            continue
        value = getattr(data, prop.identifier)
        if prop.type == "POINTER" and value is not None:
            result[prop.identifier] = struct(value)
        elif prop.type == "FLOAT" and prop.subtype in ("COLOR", "COLOR_GAMMA"):
            result[prop.identifier] = [round(v, 4) for v in value]
        elif prop.type in ("FLOAT", "INT", "BOOLEAN", "ENUM"):
            result[prop.identifier] = list(value) if getattr(prop, "array_length", 0) else value
    return result


theme = bpy.context.preferences.themes[0]
data = {name: struct(getattr(theme, name)) for name in EDITORS}
with open(out, "w") as f:
    json.dump(data, f, indent=1, sort_keys=True)
print("theme written")
