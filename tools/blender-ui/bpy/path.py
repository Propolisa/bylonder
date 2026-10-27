# bpy.path: display_name as Blender's scripts/modules/bpy/path.py writes it, for names without file extensions.
def display_name(name, has_ext=True, title_case=True):
    name = name.replace("_", " ").lstrip(" ")
    if title_case and name.islower():
        name = name.lower().title()
    return name
