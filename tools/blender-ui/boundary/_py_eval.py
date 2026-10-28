# Python's eval and exec for the snippets Blender's scripts build at run time ("context.space_data.show_region_ui",
# "context.scene.frame_current += self.value"): an interpreter of Python's expressions and assignments over the names
# the caller gives (tree.py passes a function's names and its module's globals).
_PUNCTUATION = ['**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '(', ')', '[', ']', ',', '.', ':', '+', '-', '*', '/', '%', '<', '>', '=']
_KEYWORDS = {'True': True, 'False': False, 'None': None}


def _tokens(source):
    tokens, i = [], 0
    while i < len(source):
        c = source[i]
        if c in ' \t\n':
            i += 1
        elif c.isdigit() or (c == '.' and i + 1 < len(source) and source[i + 1].isdigit()):
            j = i
            while j < len(source) and (source[j].isdigit() or source[j] in '.eE' or (source[j] in '+-' and source[j - 1] in 'eE')):
                j += 1
            text = source[i:j]
            tokens.append(('number', float(text) if any(x in text for x in '.eE') else int(text)))
            i = j
        elif c in '\'"':
            j, out = i + 1, ''
            while source[j] != c:
                if source[j] == '\\':
                    j += 1
                out += source[j]
                j += 1
            tokens.append(('string', out))
            i = j + 1
        elif c.isalpha() or c == '_':
            j = i
            while j < len(source) and (source[j].isalnum() or source[j] == '_'):
                j += 1
            tokens.append(('name', source[i:j]))
            i = j
        else:
            op = next(p for p in _PUNCTUATION if source[i:i + len(p)] == p)
            tokens.append(('op', op))
            i += len(op)
    tokens.append(('end', None))
    return tokens


class _Parser:
    def __init__(self, source, names):
        self.tokens, self.at, self.names = _tokens(source), 0, names

    def peek(self):
        return self.tokens[self.at]

    def take(self, value=None):
        token = self.tokens[self.at]
        if value is not None and token[1] != value:
            raise SyntaxError('expected ' + value + ' in ' + str(token[1]))
        self.at += 1
        return token

    def accept(self, value):
        if self.peek()[0] in ('op', 'name') and self.peek()[1] == value:
            self.at += 1
            return True
        return False

    # Each node is (get, set): get() reads it, set(value) assigns it (names, attributes and subscripts).
    def statement(self):
        target = self.expression()
        for op in ('=', '+=', '-=', '*=', '/='):
            if self.accept(op):
                value = self.expression()[0]()
                if op != '=':
                    value = _binary(op[0], target[0](), value)
                target[1](value)
                return None
        return target[0]()

    def expression(self):
        node = self.disjunction()
        if self.peek()[1] == ',':
            items = [node]
            while self.accept(','):
                if self.peek()[0] == 'end' or self.peek()[1] in (')', ']', '='):
                    break
                items.append(self.disjunction())
            return (lambda: tuple([n[0]() for n in items]), None)
        return node

    def disjunction(self):
        node = self.conjunction()
        while self.accept('or'):
            left, right = node, self.conjunction()
            node = (lambda left=left, right=right: left[0]() or right[0](), None)
        return node

    def conjunction(self):
        node = self.negation()
        while self.accept('and'):
            left, right = node, self.negation()
            node = (lambda left=left, right=right: left[0]() and right[0](), None)
        return node

    def negation(self):
        if self.accept('not'):
            operand = self.negation()
            return (lambda: not operand[0](), None)
        return self.comparison()

    def comparison(self):
        node = self.sum()
        while self.peek()[1] in ('==', '!=', '<', '>', '<=', '>=', 'in'):
            op, left, right = self.take()[1], node, self.sum()
            node = (lambda op=op, left=left, right=right: _compare(op, left[0](), right[0]()), None)
        return node

    def sum(self):
        node = self.product()
        while self.peek()[1] in ('+', '-'):
            op, left, right = self.take()[1], node, self.product()
            node = (lambda op=op, left=left, right=right: _binary(op, left[0](), right[0]()), None)
        return node

    def product(self):
        node = self.unary()
        while self.peek()[1] in ('*', '/', '//', '%'):
            op, left, right = self.take()[1], node, self.unary()
            node = (lambda op=op, left=left, right=right: _binary(op, left[0](), right[0]()), None)
        return node

    def unary(self):
        if self.accept('-'):
            operand = self.unary()
            return (lambda: -operand[0](), None)
        return self.postfix(self.atom())

    def atom(self):
        kind, value = self.take()
        if kind in ('number', 'string'):
            return (lambda: value, None)
        if kind == 'name':
            if value in _KEYWORDS:
                return (lambda: _KEYWORDS[value], None)
            names = self.names
            return (lambda: names[value], lambda v: names.__setitem__(value, v))
        if value == '(':
            node = self.expression() if self.peek()[1] != ')' else (lambda: tuple(), None)
            self.take(')')
            return node
        if value == '[':
            items = []
            while not self.accept(']'):
                items.append(self.disjunction())
                self.accept(',')
            return (lambda: [n[0]() for n in items], None)
        raise SyntaxError('unexpected ' + str(value))

    def postfix(self, node):
        while True:
            if self.accept('.'):
                owner, name = node, self.take()[1]
                node = (lambda owner=owner, name=name: getattr(owner[0](), name), lambda v, owner=owner, name=name: setattr(owner[0](), name, v))
            elif self.accept('['):
                owner = node
                if self.accept(':'):
                    self.take(']')
                    node = (lambda owner=owner: list(owner[0]()), None)
                    continue
                key = self.expression()
                self.take(']')
                node = (lambda owner=owner, key=key: owner[0]()[key[0]()], lambda v, owner=owner, key=key: owner[0]().__setitem__(key[0](), v))
            elif self.accept('('):
                function, arguments = node, []
                while not self.accept(')'):
                    arguments.append(self.disjunction())
                    self.accept(',')
                node = (lambda function=function, arguments=arguments: function[0]()(*[a[0]() for a in arguments]), None)
            else:
                return node


def _binary(op, a, b):
    if op == '+':
        return a + b
    if op == '-':
        return a - b
    if op == '*':
        return a * b
    if op == '/':
        return a / b
    if op == '//':
        return a // b
    return a % b


def _compare(op, a, b):
    if op == '==':
        return a == b
    if op == '!=':
        return a != b
    if op == '<':
        return a < b
    if op == '>':
        return a > b
    if op == '<=':
        return a <= b
    if op == '>=':
        return a >= b
    return a in b


class _Names:
    """The caller's names, then its module's globals, then Python's builtins the snippets call."""

    def __init__(self, local, module):
        self.local, self.module = local, module

    def __getitem__(self, name):
        if name in self.local:
            return self.local[name]
        found = getattr(self.module, name, None) if self.module is not None else None
        if found is not None:
            return found
        return {'round': round, 'min': min, 'max': max, 'abs': abs, 'int': int, 'float': float, 'str': str, 'len': len,
                'bool': bool, 'list': list, 'tuple': tuple}[name]

    def __setitem__(self, name, value):
        self.local[name] = value


def _py_eval(source, local, module=None):
    parser = _Parser(source, local if isinstance(local, _Names) else _Names(local, module))
    return parser.expression()[0]()


def _py_exec(source, local, module=None):
    parser = _Parser(source, _Names(local, module))
    parser.statement()
