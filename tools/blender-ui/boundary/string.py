ascii_lowercase = 'abcdefghijklmnopqrstuvwxyz'
ascii_uppercase = ascii_lowercase.upper()
ascii_letters = ascii_lowercase + ascii_uppercase
digits = '0123456789'
hexdigits = digits + 'abcdefABCDEF'
punctuation = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
whitespace = ' \t\n\r\x0b\x0c'


class Template:
    def __init__(self, template):
        self.template = template

    def substitute(self, mapping=None, **kwargs):
        values = dict(mapping or {})
        values.update(kwargs)
        text = self.template
        for key in values:
            text = text.replace('${' + key + '}', str(values[key])).replace('$' + key, str(values[key]))
        return text

    safe_substitute = substitute
