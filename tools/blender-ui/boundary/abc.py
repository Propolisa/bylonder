# Transcrypt classes have no abstract methods: these only mark them.
ABCMeta = type


class ABC:
    pass


def abstractmethod(function):
    return function
