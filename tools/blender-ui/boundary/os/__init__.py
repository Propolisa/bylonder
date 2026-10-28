# Python's os for Blender's scripts in the browser: a read-only file system holding Blender's scripts (os.path).
import os.path as path

sep = '/'
pathsep = ':'
curdir = '.'
environ = {}


def listdir(directory='.'):
    prefix = path.normpath(directory) + '/'
    return sorted({entry[len(prefix):].split('/')[0] for entry in path.files + sorted(path._directories) if entry.startswith(prefix)})


class DirEntry:
    def __init__(self, directory, name):
        self.name, self.path = name, path.join(directory, name)

    def is_dir(self):
        return path.isdir(self.path)

    def is_file(self):
        return path.isfile(self.path)


def scandir(directory='.'):
    return [DirEntry(directory, name) for name in listdir(directory)]


def getcwd():
    return '/'


def fspath(name):
    return name


def getenv(key, default=None):
    return environ.get(key, default)
