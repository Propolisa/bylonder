"""Pre-initializes a module (as Wizer does): runs its initialization once (_initialize, then blender_init: Blender's
RNA_init and node registration, the same every time) and writes the memory it leaves as the module's data, so that
loading it starts where initialization ended. The exports that initialize are removed, so the host does not run them
again. The stack (first in memory) is not kept, as nothing is on it then.
The module's memory is shared (wasm32-wasi-threads): each thread instantiates the module on it, so its data is passive
and wasm-ld's start function copies it in once, guarded by a flag in memory, and sets the first thread's TLS base.
The snapshot's data takes the original segments' place there; the TLS segment stays, as each new thread copies its
thread-locals from it.
usage: wasm_snapshot.py MODULE.wasm OUT.wasm"""
import os
import subprocess
import sys
import tempfile

from wasm_weaken import leb

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.realpath(os.path.join(HERE, '..', '..'))
CUSTOM, IMPORT, GLOBAL, EXPORT, START, CODE, DATA, DATACOUNT = 0, 2, 6, 7, 8, 10, 11, 12
INITIALIZERS = {'_initialize', 'blender_init'}
# Zero bytes between nonzero ones that stay in one data segment (a segment costs about 6 bytes), widened until the
# segments are fewer than engines take (V8: 100000).
GAP = 16
SEGMENTS = 50000
# Blender's datafiles are in its file system as in the app (bmesh-wasm.js), for what initialization reads: color
# management's config. Initialization runs on one thread.
DUMP = """
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { instantiate, files } = await import(pathToFileURL(process.argv[1]));
const { DATAFILES, COLOR_MANAGEMENT } = await import(pathToFileURL(process.argv[4]));
for (const [name, url] of [...DATAFILES, ...COLOR_MANAGEMENT]) files.set(`/blender/datafiles/${name}`, new Uint8Array(fs.readFileSync(url)));
const heap = await instantiate(pathToFileURL(process.argv[2]), 1);
fs.writeFileSync(process.argv[3], new Uint8Array(heap.exports.memory.buffer));
"""


def uleb(value):
    out = bytearray()
    while True:
        byte = value & 0x7f
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def sleb(value):
    out = bytearray()
    while True:
        byte = value & 0x7f
        value >>= 7
        done = (value == 0 and not byte & 0x40) or (value == -1 and byte & 0x40)
        out.append(byte | (0 if done else 0x80))
        if done:
            return bytes(out)


def sections(data):
    at = 8
    while at < len(data):
        size, body = leb(data, at + 1)
        yield data[at], data[body:body + size]
        at = body + size


def section(sid, body):
    return bytes([sid]) + uleb(len(body)) + body


def stack_top(globals_body):
    """The stack pointer's initial value: global 0, an i32.const."""
    _, at = leb(globals_body, 0)
    assert globals_body[at:at + 3] == b'\x7f\x01\x41', 'global 0 is not a mutable i32 stack pointer'
    return leb(globals_body, at + 3)[0]


def data_segments(memory, start, gap=GAP):
    """(address, bytes) of memory[start:]'s nonzero runs."""
    segments, i, end = [], start, len(memory)
    while i < end:
        if not memory[i]:
            i += 1
            continue
        first, zeros = i, 0
        while i < end and zeros <= gap:
            zeros = zeros + 1 if not memory[i] else 0
            i += 1
        segments.append((first, memory[first:i - zeros]))
    return segments if len(segments) <= SEGMENTS else data_segments(memory, start, gap * 2)


def start_function(body, first, added):
    """wasm-ld's start function with its copying of the original segments replaced by copying the snapshot's (numbered
    from `first`), keeping the TLS base it sets: (body, the TLS segment's index). The first thread to swap the flag from
    0 to 1 initializes: the code after the br_table's block, up to the flag's store of 2 (i32.const flag, i32.const 2)."""
    begin = body.index(b'\x0e\x02\x00\x01\x02\x0b') + 6
    end = body.index(b'\x41\x02\xfe\x17', begin)
    end = body.rindex(b'\x41', begin, end)
    at, operands, tls = begin, [], None
    while at < end:
        op = body[at]
        if op == 0x41:  # i32.const
            value, at = leb(body, at + 1)
            operands.append(value)
        elif op == 0x24:  # global.set: the TLS base
            tls_global, at = leb(body, at + 1)
            tls_base = operands.pop()
        else:
            assert op == 0xfc, f'unexpected instruction {op:#x} in the start function'
            sub, at = leb(body, at + 1)
            assert sub in (8, 11), f'unexpected instruction 0xfc {sub} in the start function'
            if sub == 8:  # memory.init segment memory: the segment copied to the TLS base is the TLS segment
                segment, at = leb(body, at)
                if operands[-3] == tls_base:
                    tls = segment
            at += 1
            del operands[-3:]
    code = b'\x41' + sleb(tls_base) + b'\x24' + uleb(tls_global)
    for i, (address, data) in enumerate(added):
        code += b'\x41' + sleb(address) + b'\x41\x00\x41' + sleb(len(data)) + b'\xfc\x08' + uleb(first + i) + b'\x00'
    return body[:begin] + code + body[end:], tls


def code_entries(body):
    count, at = leb(body, 0)
    entries = []
    for _ in range(count):
        size, start = leb(body, at)
        entries.append(body[start:start + size])
        at = start + size
    return entries


def passive_segments(body):
    """Each data segment's bytes (wasm-ld makes every segment of a shared memory passive)."""
    count, at = leb(body, 0)
    entries = []
    for _ in range(count):
        assert body[at] == 1, 'a data segment of a shared memory is not passive'
        size, start = leb(body, at + 1)
        entries.append(body[start:start + size])
        at = start + size
    return entries


def limits_end(body, at):
    """The end of the limits at `at`."""
    flags = body[at]
    _, at = leb(body, at + 1)
    return leb(body, at)[1] if flags & 1 else at


def imports(body):
    """(imported functions, offset of the memory import's limits) in an import section."""
    count, at = leb(body, 0)
    functions, memory = 0, None
    for _ in range(count):
        for _ in range(2):
            length, at = leb(body, at)
            at += length
        kind, at = body[at], at + 1
        if kind == 0:
            functions += 1
            _, at = leb(body, at)
        elif kind == 1:
            at = limits_end(body, at + 1)
        elif kind == 2:
            memory, at = at, limits_end(body, at)
        elif kind == 3:
            at += 2
        else:
            _, at = leb(body, at + 1)
    return functions, memory


def exports_without_initializers(body):
    count, at = leb(body, 0)
    kept = []
    for _ in range(count):
        length, name_at = leb(body, at)
        name = body[name_at:name_at + length].decode()
        _, end = leb(body, name_at + length + 1)
        if name not in INITIALIZERS:
            kept.append(body[at:end])
        at = end
    return uleb(len(kept)) + b''.join(kept)


def initialized_memory(module):
    with tempfile.TemporaryDirectory() as work:
        out = os.path.join(work, 'memory')
        subprocess.run(['node', '--input-type=module', '-e', DUMP, os.path.join(REPO, 'src', 'port', 'wasm.js'), module, out,
                        os.path.join(REPO, 'src', 'bmesh', 'datafiles.js')],
                       check=True, stdout=subprocess.DEVNULL)
        return open(out, 'rb').read()


def snapshot(module, out, named=None):
    """The initialized module at out, without names; with named, also a copy that keeps the name section (same code
    offsets, for naming the frames of a crash in the shipped module)."""
    data = open(module, 'rb').read()
    memory = initialized_memory(module)
    parts = dict(sections(data))
    functions, limits = imports(parts[IMPORT])
    originals = passive_segments(parts[DATA])
    added = data_segments(memory, stack_top(parts[GLOBAL]))
    code = code_entries(parts[CODE])
    start = leb(parts[START], 0)[0] - functions
    code[start], tls = start_function(code[start], len(originals), added)
    segments = [segment if i == tls else b'' for i, segment in enumerate(originals)] + [bytes(d) for _, d in added]
    result, names = bytearray(data[:8]), b''
    for sid, body in sections(data):
        if sid == IMPORT:
            # The memory's minimum: the pages initialization grew it to (malloc's sbrk reads memory.size).
            _, at = leb(body, limits + 1)
            body = body[:limits + 1] + uleb(len(memory) // 65536) + body[at:]
        elif sid == EXPORT:
            body = exports_without_initializers(body)
        elif sid == CODE:
            body = uleb(len(code)) + b''.join(uleb(len(c)) + c for c in code)
        elif sid == DATACOUNT:
            body = uleb(len(segments))
        elif sid == DATA:
            body = uleb(len(segments)) + b''.join(b'\x01' + uleb(len(s)) + s for s in segments)
        elif sid == CUSTOM:
            if body[1:].startswith(b'name'):
                names = section(sid, body)
            continue
        result += section(sid, body)
    open(out, 'wb').write(result)
    if named:
        open(named, 'wb').write(result + names)
    print(f'{out}: initialized ({len(memory) >> 20} MiB memory, {len(added)} segments), {len(result)} bytes', file=sys.stderr)


if __name__ == '__main__':
    snapshot(sys.argv[1], sys.argv[2])
