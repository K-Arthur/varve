#!/usr/bin/env python3
"""
Incremental-vs-full repaint oracle, executed in the system WebKitGTK.

For each gesture: perform it, let the canvas settle, capture the content
canvas, force an authoritative full redraw of the *same* document and camera
via `window.__strataPerf.forceFullRedraw()`, capture again, and compare.

Any pixel that differs is a pixel the incremental path got wrong — a stale
origin, a ghost trail, an uncleared region or a seam. Comparing against a
forced repaint (rather than a stored baseline) means nothing else changed
between the two captures, so a diff cannot be blamed on layout or theme.

Usage:
  run-ghosting-oracle.py <dist-dir> [--query=?perf=1] [--wait=240] [--out=f.json]
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
WAIT_S = float(arg("wait", "240"))
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


ORACLE_JS = r"""
(function () {
  if (window.__oracleStarted) return 'already';
  window.__oracleStarted = true;
  const log = [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await frame(); await sleep(220); };

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

  /** The content canvas is the largest one in the editor surface. */
  function contentCanvas() {
    const all = Array.from(document.querySelectorAll('canvas'));
    if (!all.length) return null;
    return all.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
  }

  function capture(cv) {
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    return ctx.getImageData(0, 0, cv.width, cv.height);
  }

  /**
   * Compare two captures. `tolerance` absorbs per-channel rounding only; a
   * ghost trail is a large run of wholly different pixels, never a +-2 drift,
   * so this cannot hide the thing the oracle exists to find.
   */
  function diff(a, b, tolerance) {
    if (!a || !b) return { error: 'missing capture' };
    if (a.width !== b.width || a.height !== b.height) {
      return { error: 'size mismatch', a: [a.width, a.height], b: [b.width, b.height] };
    }
    const da = a.data, db = b.data;
    let differing = 0, maxDelta = 0;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let i = 0, px = 0; i < da.length; i += 4, px++) {
      const d0 = Math.abs(da[i] - db[i]);
      const d1 = Math.abs(da[i + 1] - db[i + 1]);
      const d2 = Math.abs(da[i + 2] - db[i + 2]);
      const d3 = Math.abs(da[i + 3] - db[i + 3]);
      const d = Math.max(d0, d1, d2, d3);
      if (d > maxDelta) maxDelta = d;
      if (d > tolerance) {
        differing++;
        const x = px % a.width, y = (px / a.width) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const total = a.width * a.height;
    return {
      differing,
      total,
      ratio: differing / total,
      maxDelta,
      bbox: maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    };
  }

  (async () => {
    try {
      // ── Reach the editor ────────────────────────────────────────────────
      if (!document.querySelector('canvas')) {
        const entry = await waitFor(
          () => findButton(/^new$/i) || findButton(/create your first design/i),
          25000, 'entry');
        if (entry) entry.click();
        await waitFor(() => document.querySelector('dialog,[role="dialog"]'), 12000, 'dialog');
        const create = await waitFor(
          () => findButton(/^create design$/i) || findButton(/^create$/i), 15000, 'create');
        if (create) create.click();
        await waitFor(
          () => document.querySelector('.layers-panel') || document.querySelector('canvas'),
          30000, 'editor');
        await sleep(4000);
      }

      const p = window.__strataPerf || window.__varvePerf;
      if (!p) { window.__oracle = JSON.stringify({ error: 'no perf handle', log }); return; }
      if (!p.forceFullRedraw) {
        window.__oracle = JSON.stringify({ error: 'no forceFullRedraw hook', log });
        return;
      }

      // ── Seed a scene with real geometry to move ─────────────────────────
      let seeded = null;
      try {
        if (p.fixtures && p.fixtures.apply) seeded = await p.fixtures.apply('vector-100');
      } catch (e) { seeded = 'apply threw: ' + String(e); }
      log.push('fixture: ' + JSON.stringify(seeded));
      await settle(10);

      const cv = contentCanvas();
      if (!cv) { window.__oracle = JSON.stringify({ error: 'no content canvas', log }); return; }
      log.push('canvas ' + cv.width + 'x' + cv.height + ' class=' + cv.className);

      const r = cv.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const send = (type, x, y, extra) => cv.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
        isPrimary: true, buttons: type === 'pointerup' ? 0 : 1, ...extra,
      }));
      const wheel = (x, y, dx, dy, ctrl) => cv.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        deltaX: dx, deltaY: dy, ctrlKey: !!ctrl,
      }));

      // `perf-vector-*` fixtures lay rects out on a 140px grid with 64x48
      // cells starting at the document origin, so a hit point is computable
      // rather than guessed — the same rule `run-production-workload.mjs`
      // uses. Guessing an offset is how a drag workload silently measures
      // nothing.
      const GRID = 140, CELL_W = 64, CELL_H = 48;
      const col = Math.max(0, Math.floor((r.width / 2 - CELL_W / 2) / GRID));
      const row = Math.max(0, Math.floor((r.height / 2 - CELL_H / 2) / GRID));
      const hitX = r.left + col * GRID + CELL_W / 2;
      const hitY = r.top + row * GRID + CELL_H / 2;
      log.push('drag hit point: ' + Math.round(hitX) + ',' + Math.round(hitY));

      const gestures = {
        // A: object drag — the classic after-image case.
        async drag() {
          send('pointerdown', hitX, hitY);
          for (let i = 0; i < 30; i++) { send('pointermove', hitX + i * 8, hitY + i * 2); await frame(); }
          send('pointerup', hitX + 240, hitY + 60);
        },
        // A2: the same total travel in small per-frame steps. If the residue
        // disappears here it is a dirty-region coverage problem proportional
        // to per-frame displacement, not a clearing bug.
        async dragSlow() {
          send('pointerdown', hitX, hitY);
          for (let i = 0; i < 120; i++) { send('pointermove', hitX + i * 2, hitY + i * 0.5); await frame(); }
          send('pointerup', hitX + 240, hitY + 60);
        },
        // B: drag to the viewport edge, which starts the auto-pan loop —
        // document and camera moving together, the case that produced the
        // original stale-pixel corruption.
        async dragAutoPan() {
          send('pointerdown', hitX, hitY);
          for (let i = 0; i < 30; i++) {
            send('pointermove', r.left + r.width - 12, hitY + i);
            await frame();
          }
          await sleep(700);
          send('pointerup', r.left + r.width - 12, hitY + 30);
        },
        // C: pure camera pan, document unchanged.
        async pan() {
          for (let i = 0; i < 30; i++) { wheel(cx, cy, 8, 6, false); await frame(); }
        },
        // D: zoom about the pointer.
        async zoom() {
          for (let i = 0; i < 20; i++) { wheel(cx, cy, 0, -30, true); await frame(); }
        },
      };

      const camera = () => {
        try {
          const f = (p.getFrames ? p.getFrames(1) : [])[0];
          return f ? { reason: f.redrawReason, path: f.renderPath } : null;
        } catch { return null; }
      };

      const results = {};
      const cameraTrace = {};
      for (const name of Object.keys(gestures)) {
        const t0 = capture(cv);
        await gestures[name]();
        await settle(8);
        const before = capture(cv);
        // Did the gesture actually change anything? A gesture that moved no
        // pixels makes its oracle result vacuous, so it is reported.
        const moved = diff(t0, before, 2);
        p.forceFullRedraw();
        await settle(8);
        const after = capture(cv);
        results[name] = diff(before, after, 2);
        results[name].gestureMovedPixels = moved.differing;
        cameraTrace[name] = camera();
        log.push(name + ': ' + JSON.stringify(results[name]));
      }

      // ── Sensitivity control ─────────────────────────────────────────────
      // Corrupt the surface directly, then force the full redraw. If the
      // oracle cannot see this, every zero above is meaningless: it would mean
      // the capture, the repaint hook, or the comparison is inert.
      let sensitivity = null;
      try {
        const ctx = cv.getContext('2d');
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgb(255,0,255)';
        ctx.fillRect(12, 12, 140, 90);
        ctx.restore();
        const corrupted = capture(cv);
        p.forceFullRedraw();
        await settle(10);
        const repaired = capture(cv);
        sensitivity = diff(corrupted, repaired, 2);
        sensitivity.detected = (sensitivity.differing || 0) > 1000;
      } catch (e) {
        sensitivity = { error: String(e) };
      }
      log.push('sensitivity: ' + JSON.stringify(sensitivity));

      window.__oracle = JSON.stringify({
        log,
        renderPath: p.renderPath ? p.renderPath() : null,
        canvas: { width: cv.width, height: cv.height },
        results,
        cameraTrace,
        sensitivity,
      });
    } catch (e) {
      window.__oracle = JSON.stringify({ error: String((e && e.stack) || e), log });
    }
  })();
  return 'started';
})()
"""


def main() -> int:
    port = free_port()
    handler = functools.partial(QuietHandler, directory=DIST)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/{QUERY}"

    out = {"url": url, "result": None}
    console = []

    window = Gtk.Window()
    window.set_decorated(False)
    window.set_default_size(1280, 800)
    window.set_title("Varve")
    webview = WebKit2.WebView()
    webview.get_settings().set_enable_developer_extras(True)
    window.add(webview)
    window.show_all()

    def on_console(_wv, message):
        try:
            console.append(f"{message.get_level()}:{message.get_text()}"[:300])
        except Exception:
            pass
        return False

    try:
        webview.connect("console-message", on_console)
    except TypeError:
        pass

    started = time.monotonic()
    done = {"v": False}

    def kickoff():
        webview.evaluate_javascript(ORACLE_JS, -1, None, None, None, lambda w, t: None)

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

        webview.evaluate_javascript("(window.__oracle || null)", -1, None, None, None, cb)

    def tick():
        elapsed = time.monotonic() - started
        if done["v"] or elapsed > WAIT_S:
            Gtk.main_quit()
            return False
        if elapsed > 5:
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
    out["session"] = os.environ.get("XDG_SESSION_TYPE")
    out["console"] = console[-20:]
    text = json.dumps(out, indent=2)
    if OUT:
        with open(OUT, "w") as fh:
            fh.write(text)
    print(text)
    return 0 if out.get("result") else 1


if __name__ == "__main__":
    sys.exit(main())
