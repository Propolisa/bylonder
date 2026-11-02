# Python's ast for Blender's scripts in the browser: CPython's parser is C, so parse() reads only a module's top-level
# assignments of literals (`bl_info = {...}`, what addon_utils reads of an add-on it does not import), and
# literal_eval evaluates them with the boundary's interpreter (_py_eval, which tree.py imports where it is used).


class AST:
    pass


class Module(AST):
    def __init__(self, body):
        self.body = body


class Name(AST):
    def __init__(self, id):
        self.id = id


class Expression(AST):
    def __init__(self, source):
        self.source = source


class Assign(AST):
    def __init__(self, targets, value):
        self.targets = targets
        self.value = value


def _statements(source):
    # Top-level statements as text: a statement ends at a line break outside brackets and strings.
    statements, depth, quote, start, i = [], 0, None, 0, 0
    while i < len(source):
        c = source[i]
        if quote:
            if c == '\\':
                i += 1
            elif source[i:i + len(quote)] == quote:
                i += len(quote) - 1
                quote = None
        elif c == '#':
            while i < len(source) and source[i] != '\n':
                i += 1
            continue
        elif c in '\'"':
            quote = source[i:i + 3] if source[i:i + 3] in ('"""', "'''") else c
            i += len(quote) - 1
        elif c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
        elif c == '\n' and depth == 0:
            statements.append(source[start:i])
            start = i + 1
        i += 1
    statements.append(source[start:])
    return [s for s in statements if s.strip()]


def parse(source, filename='<unknown>', mode='exec'):
    body = []
    for statement in _statements(source):
        if statement[0] in ' \t':
            continue
        name, sep, value = statement.partition('=')
        name = name.strip()
        if sep and name.isidentifier() and not value.startswith('='):
            body.append(Assign([Name(name)], Expression(value.strip())))
    return Module(body)


def literal_eval(node_or_string):
    source = node_or_string.source if isinstance(node_or_string, Expression) else node_or_string
    return _py_eval(source, {}, None)
