"""Build the stored package fixture with a deliberately long display name."""

import json
import zipfile
from pathlib import Path

directory = Path(__file__).parent
source = directory / "style-audit.varveplugin"
output = directory / "style-audit-long-name.varveplugin"
with zipfile.ZipFile(source) as original:
    manifest = json.loads(original.read("manifest.json"))
    wasm = original.read("module.wasm")
    thumbnail = original.read("thumbnail.png")

manifest["id"] = "dev.varve.test.long-name"
manifest["name"] = (
    "Selection Style Readiness for reviewable local package workflows "
    "with a carefully expanded long display label"
)

with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as package:
    for name, contents in (
        ("manifest.json", json.dumps(manifest, separators=(",", ":")).encode()),
        ("module.wasm", wasm),
        ("thumbnail.png", thumbnail),
    ):
        info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_STORED
        info.external_attr = 0o100644 << 16
        package.writestr(info, contents)
