"""Read only Varve's three recovery markers; never repair or reset a profile."""

import argparse
import json
import pathlib
import sqlite3

KEYS = ("strata-clean-shutdown", "varve:crash-loop", "varve:safe-mode")


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
    result = {"kind": "Read-only native recovery marker diagnostic", "certifiesQualification": False, "databases": [], "warnings": []}
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
                with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=1) as db:
                    parameters = [encoded for key in KEYS for encoded in (key, key.encode("utf-16-le"))]
                    for key, value in db.execute("SELECT key, value FROM ItemTable WHERE key IN (?, ?, ?, ?, ?, ?)", parameters):
                        decoded = decode(key)
                        if decoded in KEYS:
                            entry["markers"][decoded] = marker_value(decoded, value)
            except (sqlite3.Error, ValueError, UnicodeError, TypeError, AttributeError):
                entry["diagnosticUnavailable"] = True
            result["databases"].append(entry)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.out.write_text(json.dumps(snapshot(pathlib.Path.home()), indent=2) + "\n")
