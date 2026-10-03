#!/usr/bin/env python3
"""Security and contract tests for macOS updater archive extraction."""

from __future__ import annotations

import io
import tarfile
import tempfile
import unittest
from pathlib import Path

from extract_updater_archive import extract_updater_archive


class ExtractUpdaterArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="varve-updater-archive-")
        self.root = Path(self.temporary.name)
        self.archive = self.root / "updater.tar.gz"
        self.destination = self.root / "extract"
        self.destination.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_archive(self, members: list[tuple[str, bytes | str | None, str]]) -> None:
        with tarfile.open(self.archive, "w:gz") as output:
            for name, payload, kind in members:
                info = tarfile.TarInfo(name)
                if kind == "directory":
                    info.type = tarfile.DIRTYPE
                    output.addfile(info)
                elif kind == "symlink":
                    info.type = tarfile.SYMTYPE
                    info.linkname = str(payload)
                    output.addfile(info)
                else:
                    content = payload if isinstance(payload, bytes) else str(payload or "").encode()
                    info.size = len(content)
                    output.addfile(info, io.BytesIO(content))

    def test_extracts_one_bundle_with_internal_framework_symlink(self) -> None:
        self.write_archive(
            [
                ("Varve.app/", None, "directory"),
                ("Varve.app/Contents/", None, "directory"),
                ("Varve.app/Contents/Resources/NOTICE", b"notice", "file"),
                ("Varve.app/Contents/Frameworks/Current", "Versions/A", "symlink"),
                ("Varve.app/Contents/Helpers/Varve Helper.app/", None, "directory"),
            ]
        )
        bundle = extract_updater_archive(self.archive, self.destination)
        self.assertEqual(bundle, self.destination / "Varve.app")
        self.assertEqual((bundle / "Contents/Resources/NOTICE").read_bytes(), b"notice")
        self.assertTrue((bundle / "Contents/Frameworks/Current").is_symlink())
        self.assertTrue((bundle / "Contents/Helpers/Varve Helper.app").is_dir())

    def test_rejects_parent_traversal_before_extracting(self) -> None:
        self.write_archive([("../../outside.txt", b"escaped", "file"), ("Varve.app/", None, "directory")])
        with self.assertRaisesRegex(ValueError, "Unsafe archive member path"):
            extract_updater_archive(self.archive, self.destination)
        self.assertFalse((self.root.parent / "outside.txt").exists())
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_rejects_escaping_symlink(self) -> None:
        self.write_archive(
            [
                ("Varve.app/", None, "directory"),
                ("Varve.app/escape", "../../../../tmp/varve-outside", "symlink"),
            ]
        )
        with self.assertRaises(tarfile.FilterError):
            extract_updater_archive(self.archive, self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_rejects_multiple_bundles(self) -> None:
        self.write_archive([("One.app/", None, "directory"), ("Two.app/", None, "directory")])
        with self.assertRaisesRegex(ValueError, "exactly one macOS .app"):
            extract_updater_archive(self.archive, self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
