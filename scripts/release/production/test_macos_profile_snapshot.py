import hashlib
from contextlib import closing
import importlib.util
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("snapshot", pathlib.Path(__file__).with_name("macos-profile-snapshot.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProfileSnapshotTest(unittest.TestCase):
    def test_real_sqlite_markers_are_read_without_profile_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            home = pathlib.Path(directory)
            path = home / "Library/WebKit/dev.varve.desktop/WebsiteData/LocalStorage/tauri.localstorage"
            path.parent.mkdir(parents=True)
            with closing(sqlite3.connect(path)) as db, db:
                db.execute("CREATE TABLE ItemTable(key TEXT UNIQUE, value BLOB)")
                db.executemany("INSERT INTO ItemTable VALUES (?, ?)", [
                    (module.KEYS[0], "false".encode("utf-16-le")),
                    (module.KEYS[1], json.dumps({"failures": [10, 20], "lastClean": 5}).encode("utf-16-le")),
                    (module.KEYS[2], json.dumps({"active": True, "appVersion": "0.2.1", "enteredAt": 20, "private": "excluded"})),
                    ("unrelated-private-key", "do not retain this value"),
                ])
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            result = module.snapshot(home)
            self.assertFalse(result["certifiesQualification"])
            markers = result["databases"][0]["markers"]
            self.assertEqual(markers[module.KEYS[0]], "false")
            self.assertEqual(markers[module.KEYS[1]], {"failures": [10, 20], "lastClean": 5})
            self.assertEqual(markers[module.KEYS[2]], {"active": True, "appVersion": "0.2.1", "enteredAt": 20})
            self.assertNotIn("unrelated-private", json.dumps(result))
            self.assertNotIn("excluded", json.dumps(result))
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)

    def test_missing_corrupt_and_other_app_stores_are_not_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            home = pathlib.Path(directory)
            self.assertEqual(module.snapshot(home)["databases"], [])
            other = home / "Library/WebKit/other.app/LocalStorage/tauri.localstorage"
            other.parent.mkdir(parents=True)
            other.write_text("unrelated app data")
            path = home / "Library/WebKit/dev.varve.desktop/LocalStorage/tauri.localstorage"
            path.parent.mkdir(parents=True)
            path.write_text("not a database")
            result = module.snapshot(home)
            self.assertEqual(len(result["databases"]), 1)
            self.assertTrue(result["databases"][0]["diagnosticUnavailable"])
            self.assertFalse(result["certifiesQualification"])
            self.assertNotIn("other.app", json.dumps(result))


    def test_current_exit_guard_uses_real_sqlite_and_never_resets_markers(self):
        with tempfile.TemporaryDirectory(prefix="varve profile # ") as directory:
            home = pathlib.Path(directory)
            path = home / "Library/WebKit/dev.varve.desktop/LocalStorage/tauri.localstorage"
            path.parent.mkdir(parents=True)
            with closing(sqlite3.connect(path)) as db, db:
                db.execute("CREATE TABLE ItemTable(key BLOB UNIQUE, value BLOB)")
                db.execute("INSERT INTO ItemTable VALUES (?, ?)",
                           (module.KEYS[0].encode("utf-16-le"), "true".encode("utf-16-le")))
            native = home / "Library/Application Support/dev.varve.desktop/documents.db"
            native.parent.mkdir(parents=True)
            with closing(sqlite3.connect(native)) as db, db:
                db.execute("CREATE TABLE view_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                db.execute("INSERT INTO view_state VALUES (?, ?)",
                           (module.NATIVE_SHUTDOWN_KEY, "true"))
            before = (hashlib.sha256(path.read_bytes()).hexdigest(), hashlib.sha256(native.read_bytes()).hexdigest())
            healthy = module.snapshot(home)
            module.require_clean_current(healthy)
            self.assertEqual(healthy["nativeShutdown"], "true")
            self.assertEqual(
                (hashlib.sha256(path.read_bytes()).hexdigest(), hashlib.sha256(native.read_bytes()).hexdigest()),
                before,
                "profile diagnostics must remain read-only",
            )
            cases = [
                healthy,
                {**healthy, "databases": []},
                {**healthy, "nativeShutdown": "false"},
                {**healthy, "nativeShutdown": None},
                {**healthy, "nativeShutdownDiagnosticUnavailable": True},
                {**healthy, "databases": [{"markers": {module.KEYS[0]: "true", module.KEYS[2]: {"active": True}}}]},
                {**healthy, "databases": [{"markers": {}, "diagnosticUnavailable": True}]},
                {**healthy, "warnings": ["Profile diagnostic file bound reached"]},
                {**healthy, "certifiesQualification": True},
            ]
            for index, diagnostic in enumerate(cases):
                evidence = home / "current profile #.json"
                evidence.write_text(json.dumps(diagnostic))
                saved = evidence.read_bytes()
                process = subprocess.run([sys.executable, spec.origin, "--check-current", str(evidence)],
                                         capture_output=True, text=True)
                self.assertEqual(process.returncode == 0, index == 0, process.stderr)
                self.assertEqual(evidence.read_bytes(), saved)
                if index == 0:
                    self.assertIn("installed qualification remains separate", process.stdout)


if __name__ == "__main__":
    unittest.main()
