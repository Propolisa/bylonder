# bpy.utils: Bylonder's application templates (its examples) are listed in one path, which os.listdir reads.
def app_template_paths():
    return ['APP_TEMPLATES']


# Blender's data files, by their path under datafiles/ (tool icons).
def system_resource(kind, path=""):
    return "datafiles/" + path
