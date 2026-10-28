"""Marks defined symbols of wasm object files (and of archive members) weak, so that a strong definition elsewhere wins
at link time. llvm-objcopy cannot change wasm symbols; the weak flag is bit 0 of a symbol's flags in the object's
`linking` section, and setting it never changes the flags' LEB128 length, so the file is patched in place. Names are
matched mangled or demangled, as wasm-ld reports them demangled whatever --no-demangle says."""
import os
import subprocess
import tempfile

from wasm_module import demangle

WEAK, UNDEFINED, EXPLICIT_NAME = 0x1, 0x10, 0x40
FUNCTION, DATA, GLOBAL, SECTION, TAG, TABLE = range(6)
SYMBOL_TABLE = 8


def leb(data, at):
    value = shift = 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 0x7f) << shift
        shift += 7
        if byte < 0x80:
            return value, at


def symbols(data, at):
    """(name, flags offset, flags) of each symbol in the symbol table at `at`."""
    count, at = leb(data, at)
    for _ in range(count):
        kind = data[at]
        flags_at = at + 1
        flags, at = leb(data, flags_at)
        name = None
        if kind == SECTION:
            _, at = leb(data, at)
        elif kind == DATA:
            size, at = leb(data, at)
            name, at = bytes(data[at:at + size]).decode(), at + size
            if not flags & UNDEFINED:
                for _ in range(3):
                    _, at = leb(data, at)
        else:
            _, at = leb(data, at)
            if not flags & UNDEFINED or flags & EXPLICIT_NAME:
                size, at = leb(data, at)
                name, at = bytes(data[at:at + size]).decode(), at + size
        yield name, flags_at, flags


def weaken_object(path, names):
    """Makes the definitions of `names` in the object at `path` weak; returns those it changed."""
    data = bytearray(open(path, 'rb').read())
    found = list(defined(data))
    # c++filt and wasm-ld space template brackets differently.
    wanted = {name.replace(' ', ''): name for name in names}
    changed = set()
    for (name, flags_at), readable in zip(found, demangle([name for name, _ in found])):
        match = wanted.get(name) or wanted.get(readable.replace(' ', ''))
        if match:
            data[flags_at] |= WEAK
            changed.add(match)
    if changed:
        open(path, 'wb').write(data)
    return changed


def defined(data):
    """(name, flags offset) of each symbol the object defines."""
    at = 8
    while at < len(data):
        section = data[at]
        size, at = leb(data, at + 1)
        end = at + size
        if section == 0:
            length, body = leb(data, at)
            if bytes(data[body:body + length]) == b'linking':
                _, sub = leb(data, body + length)
                while sub < end:
                    kind = data[sub]
                    sub_size, payload = leb(data, sub + 1)
                    if kind == SYMBOL_TABLE:
                        yield from ((name, flags_at) for name, flags_at, flags in symbols(data, payload) if name and not flags & UNDEFINED)
                    sub = payload + sub_size
        at = end


def weaken_member(ar, archive, member, names):
    """weaken_object on one member of an archive, put back in its place."""
    with tempfile.TemporaryDirectory() as work:
        subprocess.run([ar, 'x', os.path.abspath(archive), member], cwd=work, check=True)
        changed = weaken_object(os.path.join(work, member), names)
        if changed:
            subprocess.run([ar, 'r', os.path.abspath(archive), member], cwd=work, check=True)
    return changed
