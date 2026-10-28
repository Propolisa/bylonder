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
