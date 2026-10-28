# CPython's contextlib, the parts Blender's scripts use.


class _GeneratorContextManager:
    def __init__(self, generator):
        self.generator = generator

    def __enter__(self):
        return next(self.generator)

    def __exit__(self, *exception):
        try:
            next(self.generator)
        except StopIteration:
            pass
        return False


def contextmanager(function):
    def manager(*args, **kwargs):
        return _GeneratorContextManager(function(*args, **kwargs))
    return manager


class closing:
    def __init__(self, thing):
        self.thing = thing

    def __enter__(self):
        return self.thing

    def __exit__(self, *exception):
        self.thing.close()
        return False


class suppress:
    def __init__(self, *exceptions):
        self.exceptions = exceptions

    def __enter__(self):
        return None

    def __exit__(self, kind, value, traceback):
        return kind is not None and any(issubclass(kind, e) for e in self.exceptions)


class redirect_stdout:
    def __init__(self, target):
        self.target = target

    def __enter__(self):
        return self.target

    def __exit__(self, *exception):
        return False


redirect_stderr = redirect_stdout
