def quote(text):
    return "'" + text.replace("'", "'\"'\"'") + "'"


def split(text, comments=False, posix=True):
    return text.split()
