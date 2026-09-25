"""Build a local permission-expanding update from the compiled analysis sample."""

import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[4]
source = root / "examples/plugins/dist/style-audit.varveplugin"
output = Path(__file__).with_name("style-audit-update.varveplugin")
with zipfile.ZipFile(source) as package:
    manifest = json.loads(package.read("manifest.json"))
    wasm = package.read("module.wasm")
manifest["version"] = "1.1.0"
manifest["permissions"]["optional"] = ["document.write"]
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as package:
    package.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
    package.writestr("module.wasm", wasm)
print(output)
