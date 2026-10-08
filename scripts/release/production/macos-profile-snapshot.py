"""Read only Varve's three recovery markers; never repair or reset a profile."""

import argparse
from contextlib import closing
import json
import pathlib
import sqlite3

KEYS = ("strata-clean-shutdown", "varve:crash-loop", "varve:safe-mode")
NATIVE_SHUTDOWN_KEY = "app-setting:native-clean-shutdown"


def decode(value):
    if isinstance(value, str):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-16-le" if b"\0" in value else "utf-8")
    raise ValueError("Unexpected marker encoding")


def marker_value(key, raw):
    text = decode(raw)
    if len(text) > 4096:
        raise ValueError("Oversized recovery marker")
    if key == KEYS[0]:
        if text not in ("true", "false"):
            raise ValueError("Invalid clean-shutdown marker")
        return text
    value = json.loads(text)
    if key == KEYS[1]:
        return {
            "failures": [n for n in value.get("failures", []) if type(n) in (int, float)],
            "lastClean": value.get("lastClean") if type(value.get("lastClean")) in (int, float) else None,
        }
    return {
        "active": value.get("active") is True,
        "appVersion": str(value.get("appVersion", ""))[:40],
        "enteredAt": value.get("enteredAt") if type(value.get("enteredAt")) in (int, float) else None,
    }


def snapshot(home):
    home = pathlib.Path(home).resolve()
    roots = [home / "Library/WebKit/dev.varve.desktop", home / "Library/Application Support/dev.varve.desktop"]
    result = {
        "kind": "Read-only native recovery marker diagnostic",
        "certifiesQualification": False,
        "databases": [],
        "nativeShutdown": None,
        "warnings": [],
    }
    scanned = 0
    for root in roots:
        if not root.exists() or root.is_symlink():
            continue
        for path in root.rglob("*"):
            scanned += 1
            if scanned > 5000:
                result["warnings"].append("Profile diagnostic file bound reached")
                return result
            if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
                continue
            if "localstorage" not in str(path.relative_to(root)).lower() or path.suffix.lower() not in (".sqlite3", ".sqlite", ".db", ".localstorage"):
                continue
            entry = {"path": str(path.relative_to(home)), "markers": {}}
            try:
                with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=1)) as db:
                    parameters = [encoded for key in KEYS for encoded in (key, key.encode("utf-16-le"))]
                    for key, value in db.execute("SELECT key, value FROM ItemTable WHERE key IN (?, ?, ?, ?, ?, ?)", parameters):
                        decoded = decode(key)
                        if decoded in KEYS:
                            entry["markers"][decoded] = marker_value(decoded, value)
            except (sqlite3.Error, ValueError, UnicodeError, TypeError, AttributeError):
                entry["diagnosticUnavailable"] = True
            result["databases"].append(entry)
    native_db = home / "Library/Application Support/dev.varve.desktop/documents.db"
    if native_db.is_file() and not native_db.is_symlink():
        try:
            with closing(sqlite3.connect(native_db.as_uri() + "?mode=ro", uri=True, timeout=1)) as db:
                row = db.execute(
                    "SELECT value FROM view_state WHERE key = ?", (NATIVE_SHUTDOWN_KEY,)
                ).fetchone()
            if row is not None:
                result["nativeShutdown"] = decode(row[0])
        except (sqlite3.Error, ValueError, UnicodeError, TypeError, AttributeError):
            result["nativeShutdownDiagnosticUnavailable"] = True
    return result


def require_clean_current(result):
    """Reject unclean or unavailable current-app exit evidence; never repair it."""
    if result.get("certifiesQualification") is not False:
        raise ValueError("Recovery diagnostics cannot replace installed qualification")
    entries = result.get("databases", [])
    if not entries:
        raise ValueError("Current Mac WebKit profile diagnostic is missing")
    if result.get("warnings") or any(entry.get("diagnosticUnavailable") for entry in entries):
        raise ValueError("Current Mac recovery diagnostic is incomplete")
    markers = [entry.get("markers", {}) for entry in entries]
    if result.get("nativeShutdownDiagnosticUnavailable"):
        raise ValueError("Current Mac native SQLite shutdown diagnostic is incomplete")
    if any(values.get(KEYS[2], {}).get("active") is True for values in markers):
        raise ValueError("Current Mac retained active recovery state")
    if result.get("nativeShutdown") != "true":
        raise ValueError("Current Mac native SQLite clean-exit marker was not observed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--out", type=pathlib.Path)
    actions.add_argument("--check-current", type=pathlib.Path)
    args = parser.parse_args()
    if args.out:
        args.out.write_text(json.dumps(snapshot(pathlib.Path.home()), indent=2) + "\n")
    else:
        require_clean_current(json.loads(args.check_current.read_text()))
        print("Current Mac native SQLite clean-exit marker observed; installed qualification remains separate.")
