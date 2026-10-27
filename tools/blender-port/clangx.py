"""libclang C API calls the Python bindings do not expose: operator kinds, variable initializers, macro kinds and
constant evaluation."""
import ctypes

import clang.cindex as ci

_POSTFIX = {1, 2}  # CXUnaryOperator_PostInc, CXUnaryOperator_PostDec
_EVAL_INT, _EVAL_FLOAT = 1, 2


class _String(ctypes.Structure):
    _fields_ = [('data', ctypes.c_void_p), ('flags', ctypes.c_uint)]


def _load():
    ci.Index.create()
    lib = ctypes.CDLL(ci.conf.get_filename())
    signatures = {
        'clang_getCString': ([_String], ctypes.c_char_p),
        'clang_disposeString': ([_String], None),
        'clang_getCursorBinaryOperatorKind': ([ci.Cursor], ctypes.c_int),
        'clang_getBinaryOperatorKindSpelling': ([ctypes.c_int], _String),
        'clang_getCursorUnaryOperatorKind': ([ci.Cursor], ctypes.c_int),
        'clang_getUnaryOperatorKindSpelling': ([ctypes.c_int], _String),
        'clang_Cursor_getVarDeclInitializer': ([ci.Cursor], ci.Cursor),
        'clang_Cursor_isNull': ([ci.Cursor], ctypes.c_int),
        'clang_Cursor_isMacroFunctionLike': ([ci.Cursor], ctypes.c_uint),
        'clang_Cursor_Evaluate': ([ci.Cursor], ctypes.c_void_p),
        'clang_EvalResult_getKind': ([ctypes.c_void_p], ctypes.c_int),
        'clang_EvalResult_getAsDouble': ([ctypes.c_void_p], ctypes.c_double),
        'clang_EvalResult_getAsLongLong': ([ctypes.c_void_p], ctypes.c_longlong),
        'clang_EvalResult_isUnsignedInt': ([ctypes.c_void_p], ctypes.c_uint),
        'clang_EvalResult_getAsUnsigned': ([ctypes.c_void_p], ctypes.c_ulonglong),
        'clang_EvalResult_dispose': ([ctypes.c_void_p], None),
    }
    for name, (args, result) in signatures.items():
        fn = getattr(lib, name)
        fn.argtypes, fn.restype = args, result
    return lib


_lib = _load()


def _spelling(fn, kind):
    s = fn(kind)
    try:
        return _lib.clang_getCString(s).decode()
    finally:
        _lib.clang_disposeString(s)


def binary_operator(c):
    """The operator of a binary or compound assignment expression, as spelled in C (`+`, `<<=`, `,`)."""
    return _spelling(_lib.clang_getBinaryOperatorKindSpelling, _lib.clang_getCursorBinaryOperatorKind(c))


def unary_operator(c):
    """(operator, is_postfix) of a unary expression."""
    kind = _lib.clang_getCursorUnaryOperatorKind(c)
    return _spelling(_lib.clang_getUnaryOperatorKindSpelling, kind), kind in _POSTFIX


def var_init(c):
    """A variable declaration's initializer expression, or None."""
    init = _lib.clang_Cursor_getVarDeclInitializer(c)
    if _lib.clang_Cursor_isNull(init):
        return None
    init._tu = c._tu
    return init


def is_function_like(macro):
    return bool(_lib.clang_Cursor_isMacroFunctionLike(macro))


def evaluate(c):
    """The value of a constant expression, or None."""
    result = _lib.clang_Cursor_Evaluate(c)
    if not result:
        return None
    try:
        kind = _lib.clang_EvalResult_getKind(result)
        if kind == _EVAL_INT:
            if _lib.clang_EvalResult_isUnsignedInt(result):
                return _lib.clang_EvalResult_getAsUnsigned(result)
            return _lib.clang_EvalResult_getAsLongLong(result)
        if kind == _EVAL_FLOAT:
            return _lib.clang_EvalResult_getAsDouble(result)
        return None
    finally:
        _lib.clang_EvalResult_dispose(result)
