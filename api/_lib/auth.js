/* ==========================================================================
   api/_lib/auth.js — Hash de contraseñas (scrypt nativo de Node), sesiones
   por cookie httpOnly, y helpers de autorización para las funciones.
   No usa dependencias externas de crypto: todo con el módulo `crypto`.
   ========================================================================== */

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getDb, ensureSchema } from './db.js';

const scrypt = promisify(_scrypt);

// Modo local (versión open source): la base de datos vive en la computadora del
// usuario y hay un solo alumno, así que no hay login ni sesiones. Se activa con
// SAT_LOCAL=1 (lo pone scripts/start-local.mjs). Sin esa variable, el modo con
// cuentas y cookies queda intacto.
export const LOCAL_MODE = process.env.SAT_LOCAL === '1';
const LOCAL_USERNAME = 'local';

const SESSION_COOKIE = 'sat_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 días
const SCRYPT_KEYLEN = 64;

/* ---------------- Contraseñas ---------------- */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hashHex) return false;
    const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

/* ---------------- Cookies ---------------- */
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value, maxAgeMs) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const maxAge = Math.floor(maxAgeMs / 1000);
  const cookie =
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  appendHeader(res, 'Set-Cookie', cookie);
}

function clearCookie(res, name) {
  appendHeader(res, 'Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function appendHeader(res, key, value) {
  const prev = res.getHeader(key);
  if (!prev) res.setHeader(key, value);
  else res.setHeader(key, Array.isArray(prev) ? [...prev, value] : [prev, value]);
}

/* ---------------- Sesiones ---------------- */
export async function createSession(res, userId) {
  await ensureSchema();
  const db = getDb();
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  await db.execute({
    sql: 'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    args: [token, userId, now, now + SESSION_TTL_MS],
  });
  setCookie(res, SESSION_COOKIE, token, SESSION_TTL_MS);
  return token;
}

export async function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const db = getDb();
    await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
  }
  clearCookie(res, SESSION_COOKIE);
}

// Devuelve el usuario autenticado (o null). Limpia sesiones caducadas.
export async function getSessionUser(req) {
  await ensureSchema();
  if (LOCAL_MODE) return getLocalUser();
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT u.id, u.username, u.role, u.display_name, u.active, s.expires_at
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token = ?`,
    args: [token],
  });
  const row = r.rows[0];
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
    return null;
  }
  if (!Number(row.active)) return null;
  return {
    id: Number(row.id),
    username: row.username,
    role: row.role,
    displayName: row.display_name || row.username,
  };
}

// Usuario único del modo local. Se crea la primera vez que se pide, así que la
// app funciona sin ningún paso de instalación. El hash guardado no es un hash
// scrypt válido: si alguien apagara SAT_LOCAL, esta cuenta no podría iniciar
// sesión con ninguna contraseña.
async function getLocalUser() {
  const db = getDb();
  const sel = { sql: 'SELECT id, display_name FROM users WHERE username = ?', args: [LOCAL_USERNAME] };
  let row = (await db.execute(sel)).rows[0];
  if (!row) {
    await db.execute({
      sql: `INSERT INTO users (username, password_hash, role, display_name, active, created_at)
            VALUES (?, 'local$no-login', 'student', 'Estudiante', 1, ?)`,
      args: [LOCAL_USERNAME, Date.now()],
    });
    row = (await db.execute(sel)).rows[0];
  }
  return {
    id: Number(row.id),
    username: LOCAL_USERNAME,
    role: 'student',
    displayName: row.display_name || 'Estudiante',
  };
}

/* ---------------- Guards ---------------- */
export async function requireUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'No autenticado' });
    return null;
  }
  return user;
}

export async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    sendJson(res, 403, { error: 'Se requiere rol de administrador' });
    return null;
  }
  return user;
}

/* ---------------- Utilidades HTTP ---------------- */
export function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel ya parseó
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}
