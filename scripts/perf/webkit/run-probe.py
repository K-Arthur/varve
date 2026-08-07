#!/usr/bin/env python3
"""
Run the Varve OffscreenCanvas capability probe inside the *system* WebKitGTK
(webkit2gtk-4.1) — the exact library Tauri links against on Linux.

Serves the probe over http on a unique loopback port (never a shared port, so
concurrent agents/test-runners on this host are unaffected), loads it in a
WebKitGTK WebView, polls for the result, prints JSON to stdout and exits.
"""

import functools
import http.server
import json
import os
import socket
import sys
import threading
import time

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
TIMEOUT_S = float(os.environ.get("PROBE_TIMEOUT", "180"))


def free_port() -> int:
    """Bind :0 to get a port nothing else on this host is using."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: A002 - silence request logging
        pass

    def end_headers(self):
        # Workers and OffscreenCanvas are not cross-origin isolated features
        # here, but keep caching off so re-runs never serve a stale probe.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve(port: int) -> http.server.ThreadingHTTPServer:
    handler = functools.partial(QuietHandler, directory=HERE)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main() -> int:
    port = free_port()
    serve(port)
    url = f"http://127.0.0.1:{port}/probe.html"

    result_holder = {}
    started = time.monotonic()

    # A real toplevel, not Gtk.OffscreenWindow: WebKitGTK's compositor needs a
    # GL context, and the offscreen backend cannot provide one ("GDK is not
    # able to create a GL context"). This matches how Tauri hosts the webview.
    window = Gtk.Window()
    window.set_default_size(1024, 768)
    window.set_title("varve-webkit-probe")
    webview = WebKit2.WebView()
    settings = webview.get_settings()
    settings.set_enable_developer_extras(True)
    settings.set_enable_write_console_messages_to_stdout(True)
    window.add(webview)
    window.show_all()

    console_lines = []

    def on_console(_wv, message):
        try:
            console_lines.append(f"{message.get_level()}: {message.get_text()}")
        except Exception:
            pass
        return False

    try:
        webview.connect("console-message", on_console)
    except TypeError:
        # Not available on every WebKit2 build; console output still goes to
        # stdout via the setting above.
        pass

    def read_result():
        """Ask the page for its result; None until the probe signals done."""

        def on_eval(wv, task):
            try:
                value = wv.evaluate_javascript_finish(task)
                payload = value.to_string() if value is not None else None
            except Exception as exc:  # noqa: BLE001
                payload = None
                result_holder.setdefault("evalErrors", []).append(str(exc))
            if payload and payload not in ("null", "undefined"):
                try:
                    result_holder["result"] = json.loads(payload)
                except json.JSONDecodeError as exc:
                    result_holder["parseError"] = f"{exc}: {payload[:400]}"

        script = (
            "(window.__probeDone ? JSON.stringify(window.__probeResult) : null)"
        )
        try:
            webview.evaluate_javascript(script, -1, None, None, None, on_eval)
        except AttributeError:
            # Older WebKit2GTK API surface.
            def on_run(wv, task):
                try:
                    js_result = wv.run_javascript_finish(task)
                    value = js_result.get_js_value()
                    payload = value.to_string()
                except Exception as exc:  # noqa: BLE001
                    payload = None
                    result_holder.setdefault("evalErrors", []).append(str(exc))
                if payload and payload not in ("null", "undefined"):
                    try:
                        result_holder["result"] = json.loads(payload)
                    except json.JSONDecodeError as exc:
                        result_holder["parseError"] = f"{exc}: {payload[:400]}"

            webview.run_javascript(script, None, on_run)

    def tick():
        if "result" in result_holder:
            Gtk.main_quit()
            return False
        if time.monotonic() - started > TIMEOUT_S:
            result_holder["timeout"] = True
            Gtk.main_quit()
            return False
        read_result()
        return True

    def on_load_changed(_wv, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(250, tick)

    webview.connect("load-changed", on_load_changed)
    webview.load_uri(url)

    Gtk.main()

    out = {
        "probeUrl": url,
        "webkitVersion": (
            f"{WebKit2.get_major_version()}.{WebKit2.get_minor_version()}."
            f"{WebKit2.get_micro_version()}"
        ),
        "sessionType": os.environ.get("XDG_SESSION_TYPE"),
        "waylandDisplay": os.environ.get("WAYLAND_DISPLAY"),
        "gdkBackend": os.environ.get("GDK_BACKEND", "(default)"),
        "timedOut": result_holder.get("timeout", False),
        "parseError": result_holder.get("parseError"),
        "evalErrors": result_holder.get("evalErrors", [])[:5],
        "console": console_lines[-30:],
        "probe": result_holder.get("result"),
    }
    print(json.dumps(out, indent=2))
    return 0 if result_holder.get("result") else 1


if __name__ == "__main__":
    sys.exit(main())
