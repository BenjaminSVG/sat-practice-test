/* Servidor de desarrollo local: sirve archivos estáticos y enruta /api/* a las
   mismas funciones que usa Vercel. Solo para pruebas locales. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// carga .env
try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = process.env.PORT || 5199;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function loadHandler(pathname) {
  // /api/a/b/c → intenta a/b/c.js, luego a/b/[id].js con query.id=c, luego a/b/index.js
  const parts = pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const base = new URL('../api/', import.meta.url);
  const query = {};
  // exacto
  try {
    const mod = await import(new URL(parts.join('/') + '.js', base));
    return { handler: mod.default, query };
  } catch {}
  // index
  try {
    const mod = await import(new URL(parts.join('/') + '/index.js', base));
    return { handler: mod.default, query };
  } catch {}
  // dinámico [id]: último segmento como id
  if (parts.length >= 1) {
    const id = parts.pop();
    query.id = id;
    try {
      const mod = await import(new URL(parts.join('/') + '/[id].js', base));
      return { handler: mod.default, query };
    } catch {}
  }
  return null;
}

const server = createServer(async (req, res) => {
  // parche estilo Vercel
  res.status = (c) => { res.statusCode = c; return res; };
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (u.pathname.startsWith('/api/')) {
    const resolved = await loadHandler(u.pathname);
    if (!resolved || !resolved.handler) { res.statusCode = 404; res.end('{"error":"not found"}'); return; }
    req.query = resolved.query;
    for (const [k, v] of u.searchParams) req.query[k] = v;
    try {
      await resolved.handler(req, res);
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // estático
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const file = join(ROOT, decodeURIComponent(p));
  try {
    const s = await stat(file);
    if (s.isDirectory()) throw new Error('dir');
    const data = await readFile(file);
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    // fallback SPA
    try {
      const data = await readFile(join(ROOT, 'index.html'));
      res.setHeader('Content-Type', 'text/html');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  }
});

// En modo local se escucha solo en 127.0.0.1: la app no pide contraseña, así que
// no debe quedar accesible desde otros equipos de la red.
const HOST = process.env.SAT_LOCAL === '1' ? '127.0.0.1' : '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`Abre http://localhost:${PORT}`));
