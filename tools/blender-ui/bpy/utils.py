# bpy.utils: Bylonder's application templates (its examples) are listed in one path, which os.listdir reads.
def app_template_paths():
    return ['APP_TEMPLATES']


def escape_identifier(text):
    return text.replace('\\', '\\\\').replace('"', '\\"')
