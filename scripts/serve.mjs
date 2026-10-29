import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Usage: node scripts/serve.mjs [rootDir] ; env BASE_PATH (e.g. /dttec-tools/) and PORT.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(process.argv[2] ?? repoRoot);
const prefix = (process.env.BASE_PATH ?? '/').replace(/\/+$/, '');
const port = Number(process.env.PORT ?? 8080);
// Serving the repo root mirrors a dev SPA fallback; serving a build mirrors Pages (404.html + 404).
const spaFallback = root === resolve(repoRoot);

async function fileAt(rel) {
  const full = normalize(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    const s = await stat(full);
    return s.isFile() ? full : null;
  } catch {
    return null;
  }
}

async function send(res, status, file) {
  const body = await readFile(file);
  res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const decoded = decodeURIComponent(pathname);
    if (prefix && decoded !== prefix && !decoded.startsWith(`${prefix}/`)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const rel = decoded.slice(prefix.length).replace(/^\/+/, '');
    const hit = await fileAt(rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel);
    if (hit) return await send(res, 200, hit);
    // App routes may contain dots (`/team/scout.sal2`); only known asset extensions 404.
    if (spaFallback && !TYPES[extname(rel)]) {
      const index = await fileAt('index.html');
      if (index) return await send(res, 200, index);
    }
    const notFound = await fileAt('404.html');
    if (notFound && !spaFallback) return await send(res, 404, notFound);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(e.message));
  }
});

server.listen(port, () => console.log(`serving ${root} at http://localhost:${port}${prefix || ''}/`));
