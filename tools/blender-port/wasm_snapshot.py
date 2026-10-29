"""Pre-initializes a module (as Wizer does): runs its initialization once (_initialize, then blender_init: Blender's
RNA_init and node registration, the same every time) and writes the memory it leaves as the module's data, so that
loading it starts where initialization ended. The exports that initialize are removed, so the host does not run them
again. The module's one mutable global is its stack pointer, which initialization leaves where it started; the stack
(first in memory) is not kept, as nothing is on it then.
usage: wasm_snapshot.py MODULE.wasm OUT.wasm"""
import os
import subprocess
import sys
import tempfile

from wasm_weaken import leb

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.realpath(os.path.join(HERE, '..', '..'))
CUSTOM, MEMORY, GLOBAL, EXPORT, DATA = 0, 5, 6, 7, 11
INITIALIZERS = {'_initialize', 'blender_init'}
# Zero bytes between nonzero ones that stay in one data segment: a segment costs about 6 bytes.
GAP = 16
DUMP = """
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { instantiate } = await import(pathToFileURL(process.argv[1]));
const heap = await instantiate(pathToFileURL(process.argv[2]));
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
    value, shift, at = 0, 0, at + 3
    while True:
        byte = globals_body[at]
        value |= (byte & 0x7f) << shift
        shift += 7
        at += 1
        if byte < 0x80:
            return value


def data_segments(memory, start):
    """Active segments for memory[start:]'s nonzero bytes."""
    segments, i, end = [], start, len(memory)
    while i < end:
        if not memory[i]:
            i += 1
            continue
        first, zeros = i, 0
        while i < end and zeros <= GAP:
            zeros = zeros + 1 if not memory[i] else 0
            i += 1
        last = i - zeros
        segments.append(b'\x00\x41' + sleb(first) + b'\x0b' + uleb(last - first) + memory[first:last])
    return uleb(len(segments)) + b''.join(segments)


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
        subprocess.run(['node', '--input-type=module', '-e', DUMP, os.path.join(REPO, 'src', 'port', 'wasm.js'), module, out],
                       check=True, stdout=subprocess.DEVNULL)
        return open(out, 'rb').read()


def snapshot(module, out):
    data = open(module, 'rb').read()
    memory = initialized_memory(module)
    parts = dict(sections(data))
    top = stack_top(parts[GLOBAL])
    pages = len(memory) // 65536
    result = bytearray(data[:8])
    for sid, body in sections(data):
        if sid == MEMORY:
            # One memory, its minimum the pages initialization grew it to (malloc's sbrk reads memory.size).
            flags = body[1]
            _, at = leb(body, 2)
            body = b'\x01' + bytes([flags]) + uleb(pages) + body[at:]
        elif sid == EXPORT:
            body = exports_without_initializers(body)
        elif sid == DATA:
            body = data_segments(memory, top)
        elif sid == CUSTOM and not body[1:].startswith(b'name'):
            continue
        result += section(sid, body)
    open(out, 'wb').write(result)
    print(f'{out}: initialized ({len(memory) >> 20} MiB memory), {len(result)} bytes', file=sys.stderr)


if __name__ == '__main__':
    snapshot(sys.argv[1], sys.argv[2])
