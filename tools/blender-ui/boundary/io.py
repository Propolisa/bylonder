class StringIO:
    def __init__(self, initial=''):
        self.parts = [initial]

    def write(self, text):
        self.parts.append(text)
        return len(text)

    def getvalue(self):
        return ''.join(self.parts)

    def read(self):
        return self.getvalue()

    def close(self):
        pass


BytesIO = StringIO


class _TextFile:
    """A text file of Blender's scripts, read-only: read, readline, iteration and `with`."""

    def __init__(self, text):
        self.text, self.at = text, 0

    def read(self):
        rest, self.at = self.text[self.at:], len(self.text)
        return rest

    def readline(self):
        end = self.text.find('\n', self.at)
        end = len(self.text) if end < 0 else end + 1
        line, self.at = self.text[self.at:end], end
        return line

    def __iter__(self):
        return self

    def __next__(self):
        line = self.readline()
        if not line:
            raise StopIteration()
        return line

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def close(self):
        pass


def _open(path, mode='r', encoding=None, **kwargs):
    """open() for Blender's scripts: the files of the scripts file system (_files) that hold text, read-only."""
    from _files import scripts
    if 'w' in mode or 'a' in mode or path not in scripts:
        raise OSError('No such file: ' + str(path))
    return _TextFile(scripts[path])
