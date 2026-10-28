# Shell patterns as regular expressions.
import re


def translate(pattern):
    out = ''
    for c in pattern:
        out += '.*' if c == '*' else '.' if c == '?' else re.escape(c)
    return '(?s:' + out + ')\\Z'


def fnmatchcase(name, pattern):
    return re.match('^' + translate(pattern).replace('(?s:', '(?:').replace('\\Z', '$'), name) is not None


fnmatch = fnmatchcase
