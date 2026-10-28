# The browser runs scripts on one thread.


class Lock:
    def acquire(self, blocking=True, timeout=-1):
        return True

    def release(self):
        pass

    def __enter__(self):
        return True

    def __exit__(self, *exception):
        return False


RLock = Condition = Lock


class Event:
    def __init__(self):
        self.flag = False

    def set(self):
        self.flag = True

    def clear(self):
        self.flag = False

    def is_set(self):
        return self.flag

    def wait(self, timeout=None):
        return self.flag


class Thread:
    def __init__(self, group=None, target=None, name=None, args=(), kwargs=None, daemon=None):
        self.target, self.args, self.kwargs, self.name = target, args, kwargs or {}, name or 'MainThread'

    def start(self):
        if self.target:
            self.target(*self.args, **self.kwargs)

    def join(self, timeout=None):
        pass

    def is_alive(self):
        return False


_main = Thread()


def main_thread():
    return _main


def current_thread():
    return _main
