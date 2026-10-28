# The browser has no interpreter exit: handlers are kept and never called.
handlers = []


def register(function, *args, **kwargs):
    handlers.append(function)
    return function


def unregister(function):
    if function in handlers:
        handlers.remove(function)
