import { getDb, ensureSchema } from '../../_lib/db.js';
import { requireAdmin, hashPassword, sendJson, readJsonBody } from '../../_lib/auth.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id)) return sendJson(res, 400, { error: 'ID inválido' });
    const db = getDb();

    const r = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
    const row = r.rows[0];
    if (!row) return sendJson(res, 404, { error: 'Usuario no encontrado' });
    if (row.role === 'admin') {
      return sendJson(res, 403, { error: 'No se puede modificar una cuenta de administrador desde aquí' });
    }

    if (req.method === 'PATCH') {
      const b = await readJsonBody(req);
      // Activar / desactivar
      if (typeof b.active === 'boolean') {
        await db.execute({ sql: 'UPDATE users SET active = ? WHERE id = ?', args: [b.active ? 1 : 0, id] });
        if (!b.active) {
          // Cierra sus sesiones al desactivar.
          await db.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [id] });
        }
      }
      // Restablecer contraseña
      if (b.password) {
        if (String(b.password).length < 6) {
          return sendJson(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres' });
        }
        const hash = await hashPassword(String(b.password));
        await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, id] });
        await db.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [id] });
      }
      // Cambiar nombre visible
      if (typeof b.displayName === 'string' && b.displayName.trim()) {
        await db.execute({
          sql: 'UPDATE users SET display_name = ? WHERE id = ?',
          args: [b.displayName.trim(), id],
        });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      // Borra el alumno y sus datos asociados (sin depender de PRAGMA foreign_keys).
      await db.batch(
        [
          { sql: 'DELETE FROM attempt_topics WHERE user_id = ?', args: [id] },
          { sql: 'DELETE FROM attempts WHERE user_id = ?', args: [id] },
          { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [id] },
          { sql: 'DELETE FROM users WHERE id = ?', args: [id] },
        ],
        'write'
      );
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: 'Método no permitido' });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
