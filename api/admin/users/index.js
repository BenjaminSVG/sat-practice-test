import { getDb, ensureSchema } from '../../_lib/db.js';
import { requireAdmin, hashPassword, sendJson, readJsonBody } from '../../_lib/auth.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const db = getDb();

    if (req.method === 'GET') {
      // Lista de alumnos con agregados para el panel del profesor.
      const r = await db.execute({
        sql: `SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_at,
                     COUNT(a.id) AS attempts,
                     MAX(a.total_score) AS best_score,
                     AVG(a.total_score) AS avg_score,
                     SUM(a.correct_count) AS sum_correct,
                     SUM(a.total_questions) AS sum_total,
                     MAX(a.created_at) AS last_activity
              FROM users u
              LEFT JOIN attempts a ON a.user_id = u.id
              WHERE u.role = 'student'
              GROUP BY u.id
              ORDER BY u.created_at DESC`,
        args: [],
      });
      const users = r.rows.map((row) => {
        const sumTotal = Number(row.sum_total || 0);
        const sumCorrect = Number(row.sum_correct || 0);
        return {
          id: Number(row.id),
          username: row.username,
          displayName: row.display_name || row.username,
          active: !!Number(row.active),
          createdAt: Number(row.created_at),
          attempts: Number(row.attempts || 0),
          bestScore: row.best_score == null ? null : Number(row.best_score),
          avgScore: row.avg_score == null ? null : Math.round(Number(row.avg_score)),
          accuracy: sumTotal ? Math.round((sumCorrect / sumTotal) * 100) : null,
          lastActivity: row.last_activity == null ? null : Number(row.last_activity),
        };
      });
      return sendJson(res, 200, { users });
    }

    if (req.method === 'POST') {
      const b = await readJsonBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      const displayName = String(b.displayName || '').trim() || username;
      if (!username || !password) {
        return sendJson(res, 400, { error: 'Usuario y contraseña son obligatorios' });
      }
      if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
        return sendJson(res, 400, {
          error: 'El usuario debe tener 3–40 caracteres (letras, números, . _ -)',
        });
      }
      if (password.length < 6) {
        return sendJson(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres' });
      }
      const exists = await db.execute({
        sql: 'SELECT id FROM users WHERE username = ?',
        args: [username],
      });
      if (exists.rows.length) return sendJson(res, 409, { error: 'Ese usuario ya existe' });

      const hash = await hashPassword(password);
      const ins = await db.execute({
        sql: `INSERT INTO users (username, password_hash, role, display_name, active, created_at)
              VALUES (?, ?, 'student', ?, 1, ?)`,
        args: [username, hash, displayName, Date.now()],
      });
      return sendJson(res, 201, {
        user: { id: Number(ins.lastInsertRowid), username, displayName, active: true },
      });
    }

    return sendJson(res, 405, { error: 'Método no permitido' });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
