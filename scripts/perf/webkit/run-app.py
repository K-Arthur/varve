#!/usr/bin/env python3
"""
Load the real Varve production bundle in the system WebKitGTK (the exact
library Tauri links) and report which canvas render path it actually takes.

This answers the question the whole investigation turns on with a fact rather
than an inference: worker or main thread, and which gate decided.

Usage:
  run-app.py <dist-dir> [--query=?perf=1] [--wait=25] [--out=file.json]
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


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f"--{name}="):
            return a.split("=", 1)[1]
    return default


DIST = os.path.abspath(sys.argv[1])
QUERY = arg("query", "?perf=1")
WAIT_S = float(arg("wait", "25"))
OUT = arg("out")


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> int:
    port = free_port()
    handler = functools.partial(QuietHandler, directory=DIST)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/{QUERY}"

    console = []
    out = {"url": url, "webkit": None, "result": None}

    # Mirror apps/desktop/src-tauri/tauri.conf.json exactly. Varve renders its
    # own titlebar because Tauri is configured with decorations:false; a
    # decorated GTK window here would stack a second set of window controls
    # (and a second title) above the app's own, which is a harness artifact
    # rather than an app defect — and would also change the viewport height
    # the canvas is measured against.
    window = Gtk.Window()
    window.set_decorated(False)
    window.set_default_size(1280, 800)
    window.set_title("Varve")
    webview = WebKit2.WebView()
    st = webview.get_settings()
    st.set_enable_developer_extras(True)
    st.set_enable_write_console_messages_to_stdout(False)
    window.add(webview)
    window.show_all()

    def on_console(_wv, message):
        try:
            console.append(f"{message.get_level()}:{message.get_text()}"[:400])
        except Exception:
            pass
        return False

    try:
        webview.connect("console-message", on_console)
    except TypeError:
        pass

    # The page is a full app: give it time to boot, then read the diagnostics
    # handle. `probeOffscreen()` is awaited so the verified capability (not the
    # in-flight `unknown`) is what gets reported.
    # evaluate_javascript cannot serialise a Promise ("Unsupported result type"),
    # so the async collection is kicked off once and stashed on `window`; the
    # poll below reads a plain string.
    KICKOFF = """
    (function () {
      if (window.__rpStarted) return 'already';
      window.__rpStarted = true;
      const log = [];
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // The perf handle is installed by CanvasArea, so the app has to actually
      // reach the editor. This walks the documented Home -> New -> Create flow.
      const findButton = (re, root) => Array.from(
        (root || document).querySelectorAll('button,[role="button"]')
      ).find(b => re.test((b.textContent || '').trim()) ||
                  re.test(b.getAttribute('aria-label') || ''));
      const waitFor = async (fn, ms, label) => {
        const t0 = Date.now();
        for (;;) {
          const v = fn();
          if (v) return v;
          if (Date.now() - t0 > ms) { log.push('timeout:' + label); return null; }
          await sleep(150);
        }
      };
      (async () => {
        try {
          const labels = () => Array.from(
            document.querySelectorAll('button,[role="button"]')
          ).map(b => (b.textContent || '').trim() || b.getAttribute('aria-label') || '?')
           .filter(Boolean).slice(0, 40);

          if (!document.querySelector('canvas')) {
            // Either entry point reaches the new-document dialog.
            const entry = await waitFor(
              () => findButton(/^new$/i) || findButton(/create your first design/i),
              20000, 'entry-button');
            if (entry) { entry.click(); log.push('clicked entry: ' + entry.textContent.trim()); }
            await waitFor(
              () => document.querySelector('dialog,[role="dialog"]'), 10000, 'dialog');
            // The confirm button is labelled "Create design". Search the whole
            // document: several dialogs are mounted at once, so scoping to the
            // first `[role=dialog]` can miss the one that is actually open.
            const create = await waitFor(
              () => findButton(/^create design$/i) || findButton(/^create$/i),
              12000, 'create-button');
            if (create) { create.click(); log.push('clicked create'); }
            else log.push('buttons at failure: ' + JSON.stringify(labels()));
            const ok = await waitFor(
              () => document.querySelector('.layers-panel') || document.querySelector('canvas'),
              30000, 'editor');
            if (!ok) log.push('buttons after create: ' + JSON.stringify(labels()));
            // Let the canvas render real frames before sampling.
            await sleep(5000);
          }
          // Drive real interaction: an idle document renders one frame, and
          // the worker bitmap only arrives on later frames, so a static sample
          // can never observe the worker path even when it is active.
          const cv = document.querySelector('.editor-canvas canvas')
                  || document.querySelector('canvas');
          if (cv) {
            const r = cv.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const send = (type, x, y, extra) => cv.dispatchEvent(new PointerEvent(type, {
              bubbles: true, cancelable: true, composed: true,
              clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
              isPrimary: true, buttons: type === 'pointerup' ? 0 : 1, ...extra,
            }));
            // Pan the camera with the wheel: unlike a drag it needs no hit
            // target, so it produces real camera frames on any document.
            for (let i = 0; i < 40; i++) {
              cv.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true, cancelable: true,
                clientX: cx, clientY: cy, deltaX: 6, deltaY: 4,
              }));
              await new Promise(r2 => requestAnimationFrame(() => r2()));
            }
            send('pointerdown', cx, cy);
            for (let i = 0; i < 40; i++) {
              send('pointermove', cx + i * 3, cy + Math.sin(i / 4) * 12);
              await new Promise(r2 => requestAnimationFrame(() => r2()));
            }
            send('pointerup', cx + 120, cy);
            await sleep(1200);
            log.push('drove wheel+drag interaction');
          } else {
            log.push('no canvas to interact with');
          }

          const p = window.__varvePerf;
          if (!p) {
            window.__rp = JSON.stringify({
              error: 'no perf handle',
              log,
              canvasCount: document.querySelectorAll('canvas').length,
              globals: Object.keys(window).filter(k => /perf/i.test(k)),
            });
            return;
          }
          let probe = null;
          try { probe = p.probeOffscreen ? await p.probeOffscreen() : null; }
          catch (e) { probe = { error: String(e) }; }
          const frames = p.getFrames ? p.getFrames(120) : [];
          window.__rp = JSON.stringify({
            userAgent: navigator.userAgent,
            capabilities: p.capabilities ? p.capabilities() : null,
            offscreenProbe: probe,
            renderPath: p.renderPath ? p.renderPath() : null,
            log,
            frameCount: frames.length,
            framePathCounts: frames.reduce((acc, f) => {
              acc[f.renderPath] = (acc[f.renderPath] || 0) + 1; return acc;
            }, {}),
            partialRedraws: frames.filter(f => f.partialRedraw).length,
            fullRedraws: frames.filter(f => !f.partialRedraw && f.wasDirty).length,
            frameReasons: Array.from(new Set(frames.map(f => f.redrawReason))),
            workerBitmapBudget: p.workerBitmapBudget ? p.workerBitmapBudget() : null,
            canvasCount: document.querySelectorAll('canvas').length,
          });
        } catch (e) {
          window.__rp = JSON.stringify({ error: String((e && e.stack) || e) });
        }
      })();
      return 'started';
    })()
    """

    SCRIPT = "(window.__rp || null)"

    started = time.monotonic()
    done = {"v": False}

    def read():
        def cb(wv, task):
            try:
                val = wv.evaluate_javascript_finish(task)
                s = val.to_string() if val else None
            except Exception as e:
                out.setdefault("evalErr", []).append(str(e)[:200])
                return
            if s and s not in ("null", "undefined"):
                try:
                    out["result"] = json.loads(s)
                    done["v"] = True
                except json.JSONDecodeError:
                    out["raw"] = s[:500]

        webview.evaluate_javascript(SCRIPT, -1, None, None, None, cb)

    def kickoff():
        webview.evaluate_javascript(KICKOFF, -1, None, None, None, lambda w, t: None)

    def tick():
        elapsed = time.monotonic() - started
        if done["v"] or elapsed > WAIT_S:
            Gtk.main_quit()
            return False
        # Give the app time to mount and draw frames before collecting.
        if elapsed > 6:
            kickoff()
            read()
        return True

    def on_load(_wv, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(1000, tick)

    webview.connect("load-changed", on_load)
    webview.load_uri(url)
    Gtk.main()

    out["webkit"] = (
        f"{WebKit2.get_major_version()}.{WebKit2.get_minor_version()}."
        f"{WebKit2.get_micro_version()}"
    )
    # Harness window fidelity vs tauri.conf.json. Recorded so a screenshot of
    # this harness is never mistaken for the real app's chrome: decorated=True
    # here would stack a second titlebar and window controls over the ones
    # Varve draws itself (Tauri runs with decorations:false).
    out["harnessWindow"] = {
        "decorated": window.get_decorated(),
        "title": window.get_title(),
        "size": list(window.get_size()),
        "matchesTauriConfig": (
            window.get_decorated() is False
            and window.get_title() == "Varve"
            and list(window.get_size()) == [1280, 800]
        ),
    }
    out["session"] = os.environ.get("XDG_SESSION_TYPE")
    out["console"] = console[-25:]
    text = json.dumps(out, indent=2)
    if OUT:
        with open(OUT, "w") as fh:
            fh.write(text)
    print(text)
    return 0 if out.get("result") else 1


if __name__ == "__main__":
    sys.exit(main())
