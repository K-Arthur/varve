#!/usr/bin/env python3
"""Safely extract one macOS Tauri updater app archive and print its bundle path."""

from __future__ import annotations

import argparse
import sys
import tarfile
from pathlib import Path, PurePosixPath


def extract_updater_archive(archive_path: Path, output_dir: Path) -> Path:
    if not hasattr(tarfile, "data_filter"):
        raise RuntimeError("Python 3.12 or newer is required for safe tar extraction")
    if output_dir.is_symlink() or not output_dir.is_dir():
        raise ValueError(f"Extraction destination must be an existing real directory: {output_dir}")
    if any(output_dir.iterdir()):
        raise ValueError(f"Extraction destination must be empty: {output_dir}")

    with tarfile.open(archive_path, "r:gz") as archive:
        members = archive.getmembers()
        app_roots: set[PurePosixPath] = set()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError(f"Unsafe archive member path: {member.name!r}")
            normalized = PurePosixPath(*(part for part in path.parts if part not in ("", ".")))
            for index, part in enumerate(normalized.parts):
                if part.endswith(".app"):
                    app_roots.add(PurePosixPath(*normalized.parts[: index + 1]))

        top_level_depth = min((len(root.parts) for root in app_roots), default=0)
        bundle_roots = {root for root in app_roots if len(root.parts) == top_level_depth}
        if len(bundle_roots) != 1:
            roots = ", ".join(sorted(str(root) for root in bundle_roots)) or "none"
            raise ValueError(f"Expected exactly one macOS .app bundle in updater archive; found {roots}")

        # The `data` extraction filter (Python 3.12+) rejects absolute paths,
        # parent traversal, escaping symlinks/hardlinks, devices, and unsafe
        # permissions. Validate every member before writing any of the archive,
        # then let extractall apply the same filter during extraction.
        for member in members:
            tarfile.data_filter(member, str(output_dir))
        archive.extractall(path=output_dir, members=members, filter="data")

    bundle = output_dir.joinpath(*next(iter(bundle_roots)).parts)
    if not bundle.is_dir() or bundle.is_symlink():
        raise ValueError(f"Updater archive did not produce a regular app bundle: {bundle}")
    return bundle


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        print(extract_updater_archive(args.archive, args.destination))
    except (OSError, tarfile.TarError, ValueError, RuntimeError) as error:
        print(f"updater archive rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
