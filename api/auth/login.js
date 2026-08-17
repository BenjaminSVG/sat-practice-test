import { getDb, ensureSchema } from '../_lib/db.js';
import { verifyPassword, createSession, sendJson, readJsonBody } from '../_lib/auth.js';

// Hash señuelo (contraseña/salt fijos, sin significado) usado cuando el usuario
// no existe, para que verifyPassword() siempre corra el mismo costo de scrypt y
// el tiempo de respuesta no delate si el nombre de usuario existe o no.
const DUMMY_HASH =
  'scrypt$00000000000000000000000000000000$' +
  '0'.repeat(128);

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutos

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    await ensureSchema();
    const { username, password } = await readJsonBody(req);
    if (!username || !password) {
      return sendJson(res, 400, { error: 'Usuario y contraseña son obligatorios' });
    }
    const uname = String(username).trim();
    const db = getDb();
    const now = Date.now();

    // Límite de intentos fallidos (fuerza bruta) por nombre de usuario.
    const la = await db.execute({
      sql: 'SELECT failed_count, locked_until FROM login_attempts WHERE username = ?',
      args: [uname],
    });
    const laRow = la.rows[0];
    const lockedUntil = laRow && laRow.locked_until != null ? Number(laRow.locked_until) : null;
    if (lockedUntil && lockedUntil > now) {
      return sendJson(res, 429, { error: 'Demasiados intentos fallidos. Intenta de nuevo en unos minutos.' });
    }

    const r = await db.execute({
      sql: 'SELECT id, username, password_hash, role, display_name, active FROM users WHERE username = ?',
      args: [uname],
    });
    const row = r.rows[0];
    // Verificamos siempre contra ALGÚN hash (real o señuelo) para que el tiempo
    // de respuesta no delate si el nombre de usuario existe.
    const ok = await verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok || !Number(row.active)) {
      await registerFailedAttempt(db, uname, laRow, lockedUntil, now);
      return sendJson(res, 401, { error: 'Usuario o contraseña incorrectos' });
    }

    // Login correcto: limpia el historial de intentos fallidos de este usuario.
    if (laRow) await db.execute({ sql: 'DELETE FROM login_attempts WHERE username = ?', args: [uname] });

    await createSession(res, Number(row.id));
    return sendJson(res, 200, {
      user: {
        id: Number(row.id),
        username: row.username,
        role: row.role,
        displayName: row.display_name || row.username,
      },
    });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}

async function registerFailedAttempt(db, username, laRow, prevLockedUntil, now) {
  // Si el bloqueo anterior ya expiró, arranca el conteo de nuevo.
  const prevCount = laRow && !(prevLockedUntil && prevLockedUntil <= now) ? Number(laRow.failed_count || 0) : 0;
  const count = prevCount + 1;
  const newLockedUntil = count >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : null;
  await db.execute({
    sql: `INSERT INTO login_attempts (username, failed_count, locked_until) VALUES (?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET failed_count = excluded.failed_count, locked_until = excluded.locked_until`,
    args: [username, count, newLockedUntil],
  });
}
