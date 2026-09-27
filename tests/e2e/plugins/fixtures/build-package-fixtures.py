"""Refresh stored ZIP fixtures from the public SDK example packages."""

import zipfile
from pathlib import Path


root = Path(__file__).resolve().parents[4]
examples = root / "examples/plugins/dist"
directory = Path(__file__).parent

for example, fixture in (
    ("style-audit.varveplugin", "style-audit.varveplugin"),
    ("batch-rename.varveplugin", "batch-rename.varveplugin"),
):
    source = examples / example
    output = directory / fixture
    with zipfile.ZipFile(source) as package:
        entries = [(name, package.read(name)) for name in package.namelist()]
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as package:
        for name, contents in entries:
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o100644 << 16
            package.writestr(info, contents)
    print(output)
