#!/usr/bin/env python3
"""
Does the canvas actually paint? Per-fixture render check in real WebKitGTK.

Applies each corpus fixture, waits for the scene to settle, and measures how
much of the content canvas is non-background. A scene with geometry that paints
nothing is the "blank canvas" failure; comparing worker-on against worker-off
attributes it to the render backend rather than to the scene.

Usage:
  run-render-check.py <dist-dir> --fixtures=a,b,c [--query=?perf=1] [--out=f.json]
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
FIXTURES = arg("fixtures", "vector-100,raster-heavy,mixed-raster-vector,multi-page")
WAIT_S = float(arg("wait", "300"))
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


JS = r"""
(function () {
  if (window.__rcStarted) return 'already';
  window.__rcStarted = true;
  const FIXTURES = __FIXTURES__;
  const log = [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const settle = async (n) => { for (let i = 0; i < (n||8); i++) await frame(); await sleep(400); };
  const findButton = (re, root) => Array.from(
    (root||document).querySelectorAll('button,[role="button"]')
  ).find(b => re.test((b.textContent||'').trim()) || re.test(b.getAttribute('aria-label')||''));
  const waitFor = async (fn, ms, label) => {
    const t0 = Date.now();
    for (;;) { const v = fn(); if (v) return v;
      if (Date.now()-t0 > ms) { log.push('timeout:'+label); return null; } await sleep(150); }
  };
  function contentCanvas() {
    const all = Array.from(document.querySelectorAll('canvas'));
    if (!all.length) return null;
    return all.slice().sort((a,b) => (b.width*b.height)-(a.width*a.height))[0];
  }
  /**
   * Fraction of pixels differing from the modal (background) colour. A scene
   * that painted nothing scores ~0 no matter what the board colour is.
   */
  function inkCoverage(cv) {
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const counts = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i]<<16) | (d[i+1]<<8) | d[i+2];
      counts.set(k, (counts.get(k)||0) + 1);
    }
    let modal = 0, modalCount = 0;
    for (const [k, c] of counts) if (c > modalCount) { modalCount = c; modal = k; }
    const total = cv.width * cv.height;
    return {
      total,
      distinctColours: counts.size,
      backgroundColour: '#' + modal.toString(16).padStart(6,'0'),
      inkRatio: (total - modalCount) / total,
    };
  }
  (async () => {
    try {
      if (!document.querySelector('canvas')) {
        const entry = await waitFor(() => findButton(/^new$/i) || findButton(/create your first design/i), 25000, 'entry');
        if (entry) entry.click();
        await waitFor(() => document.querySelector('dialog,[role="dialog"]'), 12000, 'dialog');
        const create = await waitFor(() => findButton(/^create design$/i) || findButton(/^create$/i), 15000, 'create');
        if (create) create.click();
        await waitFor(() => document.querySelector('.layers-panel') || document.querySelector('canvas'), 30000, 'editor');
        await sleep(4000);
      }
      const p = window.__strataPerf || window.__varvePerf;
      if (!p) { window.__rc = JSON.stringify({ error: 'no perf handle', log }); return; }
      const cv = contentCanvas();
      if (!cv) { window.__rc = JSON.stringify({ error: 'no canvas', log }); return; }

      const out = {};
      for (const fx of FIXTURES) {
        let applied = null;
        try { applied = await p.fixtures.apply(fx); }
        catch (e) { out[fx] = { error: 'apply threw: ' + e }; continue; }
        await settle(14);
        // Fit the view so the fixture is actually on screen before judging it
        // blank; an off-camera scene is not a rendering failure.
        try { document.querySelector('canvas')?.focus(); } catch {}
        await settle(6);
        const cov = inkCoverage(cv);
        const frames = p.getFrames ? p.getFrames(30) : [];
        out[fx] = {
          nodeCount: applied && applied.nodeCount,
          ...cov,
          framePaths: Array.from(new Set(frames.map(f => f.renderPath))),
          reasons: Array.from(new Set(frames.map(f => f.redrawReason))),
        };
        log.push(fx + ' ink=' + cov.inkRatio.toFixed(5) + ' colours=' + cov.distinctColours);
      }
      window.__rc = JSON.stringify({
        renderPath: p.renderPath ? p.renderPath() : null,
        canvas: { w: cv.width, h: cv.height },
        fixtures: out, log,
      });
    } catch (e) { window.__rc = JSON.stringify({ error: String((e&&e.stack)||e), log }); }
  })();
  return 'started';
})()
""".replace("__FIXTURES__", json.dumps(FIXTURES.split(",")))


def main() -> int:
    port = free_port()
    handler = functools.partial(QuietHandler, directory=DIST)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/{QUERY}"
    out = {"url": url, "result": None}

    window = Gtk.Window()
    window.set_decorated(False)
    window.set_default_size(1280, 800)
    window.set_title("Varve")
    webview = WebKit2.WebView()
    webview.get_settings().set_enable_developer_extras(True)
    window.add(webview)
    window.show_all()

    started = time.monotonic()
    done = {"v": False}

    def read():
        def cb(wv, task):
            try:
                val = wv.evaluate_javascript_finish(task)
                s = val.to_string() if val else None
            except Exception:
                return
            if s and s not in ("null", "undefined"):
                try:
                    out["result"] = json.loads(s)
                    done["v"] = True
                except json.JSONDecodeError:
                    out["raw"] = s[:600]

        webview.evaluate_javascript("(window.__rc || null)", -1, None, None, None, cb)

    def tick():
        e = time.monotonic() - started
        if done["v"] or e > WAIT_S:
            Gtk.main_quit()
            return False
        if e > 5:
            webview.evaluate_javascript(JS, -1, None, None, None, lambda w, t: None)
            read()
        return True

    def on_load(_wv, ev):
        if ev == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(1000, tick)

    webview.connect("load-changed", on_load)
    webview.load_uri(url)
    Gtk.main()

    out["webkit"] = (
        f"{WebKit2.get_major_version()}.{WebKit2.get_minor_version()}."
        f"{WebKit2.get_micro_version()}"
    )
    text = json.dumps(out, indent=2)
    if OUT:
        with open(OUT, "w") as fh:
            fh.write(text)
    print(text)
    return 0 if out.get("result") else 1


if __name__ == "__main__":
    sys.exit(main())
