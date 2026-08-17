import { getDb, ensureSchema } from './_lib/db.js';
import { requireUser, verifyPassword, hashPassword, sendJson, readJsonBody } from './_lib/auth.js';

// PATCH /api/account — el usuario cambia su propio nombre visible y/o contraseña.
export default async function handler(req, res) {
  if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    await ensureSchema();
    const user = await requireUser(req, res);
    if (!user) return;
    const db = getDb();
    const b = await readJsonBody(req);

    let displayName = user.displayName;
    if (typeof b.displayName === 'string' && b.displayName.trim()) {
      displayName = b.displayName.trim().slice(0, 80);
      await db.execute({
        sql: 'UPDATE users SET display_name = ? WHERE id = ?',
        args: [displayName, user.id],
      });
    }

    if (b.newPassword) {
      if (String(b.newPassword).length < 6) {
        return sendJson(res, 400, { error: 'La nueva contraseña debe tener al menos 6 caracteres' });
      }
      const r = await db.execute({
        sql: 'SELECT password_hash FROM users WHERE id = ?',
        args: [user.id],
      });
      const okCur = r.rows[0] && (await verifyPassword(String(b.currentPassword || ''), r.rows[0].password_hash));
      if (!okCur) return sendJson(res, 403, { error: 'La contraseña actual es incorrecta' });
      const hash = await hashPassword(String(b.newPassword));
      await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, user.id] });
    }

    return sendJson(res, 200, { ok: true, displayName });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
