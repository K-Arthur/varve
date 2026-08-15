#!/usr/bin/env node
import fs from 'node:fs';
/**
 * Minimal static server for the built website (Playwright webServer).
 *
 * Serves a built Astro output directory with GitHub Pages layout:
 *   - /varve/* and / both work (base path is ignored; directory format
 *     resolves /route to /route/index.html)
 *   - missing routes fall back to 404.html with a 404 status
 *
 * Usage: node scripts/serve-dist.mjs <port> <dist-dir>
 */
import http from 'node:http';
import path from 'node:path';

const port = Number(process.argv[2] ?? 4321);
const root = path.resolve(process.argv[3] ?? 'dist');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`serve-dist: no index.html in ${root}`);
  process.exit(1);
}

/**
 * Resolve a request path to a file inside `root`, or null when it would
 * escape. `path.join` already collapses `..` segments, so a plain
 * `resolved.startsWith(root)` check is insufficient: a sibling directory
 * that merely shares `root`'s string prefix (e.g. `dist-evil` next to
 * `dist`) would pass it. `path.relative` gives an unambiguous boundary
 * check instead.
 */
function resolveWithinRoot(urlPath) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  // Normalize: strip a /varve base prefix if present, map / to index.html.
  clean = clean.replace(/^\/varve(?=\/|$)/, '');
  if (clean === '/') clean = '/index.html';
  const candidate = path.join(root, clean);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

const server = http.createServer((req, res) => {
  let file = resolveWithinRoot(req.url);
  if (file === null) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      });
      res.end(fs.readFileSync(file));
      return;
    }
  } catch {
    // fall through to 404
  }
  const notFound = path.join(root, '404.html');
  if (fs.existsSync(notFound)) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(notFound));
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(port, () => {
  console.log(`serve-dist: ${root} on http://127.0.0.1:${port}`);
});
