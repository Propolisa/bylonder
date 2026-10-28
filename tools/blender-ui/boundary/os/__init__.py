# Python's os for Blender's scripts in the browser: there is no file system, so listings are empty and paths are only
# strings (os.path).
import os.path as path

sep = '/'
pathsep = ':'
curdir = '.'
environ = {}


def listdir(directory='.'):
    return []


def scandir(directory='.'):
    return []


def getcwd():
    return '/'


def fspath(name):
    return name


def getenv(key, default=None):
    return environ.get(key, default)
