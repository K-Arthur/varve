"""Rebuild the controlled infinite-loop plugin fixture; never run it outside a worker."""

import json
import zipfile
from pathlib import Path


def leb(value: int) -> bytes:
    encoded = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        encoded.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(encoded)


def string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return leb(len(encoded)) + encoded


def section(section_id: int, payload: bytes) -> bytes:
    return bytes([section_id]) + leb(len(payload)) + payload


types = b"\x03\x60\x01\x7f\x01\x7f\x60\x02\x7f\x7f\x01\x7f\x60\x00\x01\x7f"
imports = b"\x01" + string("env") + string("memory") + b"\x02\x01" + leb(64) + leb(256)
functions = b"\x03\x00\x01\x02"
exports = b"\x03" + b"".join(
    string(name) + b"\x00" + leb(index)
    for index, name in enumerate(("alloc", "run", "result_len"))
)
bodies = (
    b"\x00\x41\x00\x0b",  # alloc returns pointer zero
    b"\x00\x03\x40\x0c\x00\x0b\x41\x00\x0b",  # run loops forever
    b"\x00\x41\x00\x0b",  # result_len returns zero
)
code = b"\x03" + b"".join(leb(len(body)) + body for body in bodies)
wasm = b"\x00asm\x01\x00\x00\x00" + b"".join(
    section(section_id, payload)
    for section_id, payload in ((1, types), (2, imports), (3, functions), (7, exports), (10, code))
)
manifest = {
    "schemaVersion": 1,
    "id": "dev.varve.test.loop",
    "name": "Controlled Loop Fixture",
    "publisher": "Varve test fixture",
    "version": "1.0.0",
    "apiVersion": 1,
    "entry": "module.wasm",
    "permissions": {"required": ["selection.read"], "optional": []},
    "commands": [{"id": "loop", "title": "Run controlled loop", "kind": "analysis"}],
}
output = Path(__file__).with_name("fault-loop.varveplugin")
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as package:
    package.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
    package.writestr("module.wasm", wasm)
print(f"{output}: {len(wasm)} Wasm bytes")
