import { getDb, ensureSchema } from '../_lib/db.js';
import { requireUser, sendJson } from '../_lib/auth.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const user = await requireUser(req, res);
    if (!user) return;
    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id)) return sendJson(res, 400, { error: 'ID inválido' });
    const db = getDb();

    const r = await db.execute({
      sql: 'SELECT * FROM attempts WHERE id = ?',
      args: [id],
    });
    const row = r.rows[0];
    if (!row) return sendJson(res, 404, { error: 'Intento no encontrado' });
    // Solo el dueño o un admin pueden verlo.
    if (Number(row.user_id) !== user.id && user.role !== 'admin') {
      return sendJson(res, 403, { error: 'No autorizado' });
    }

    if (req.method === 'DELETE') {
      await db.batch(
        [
          { sql: 'DELETE FROM attempt_topics WHERE attempt_id = ?', args: [id] },
          { sql: 'DELETE FROM attempts WHERE id = ?', args: [id] },
        ],
        'write'
      );
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET') {
      let questions = [];
      try {
        questions = JSON.parse(row.questions_json || '[]');
      } catch {
        questions = [];
      }
      return sendJson(res, 200, {
        attempt: {
          id: Number(row.id),
          title: row.title,
          mode: row.mode,
          createdAt: Number(row.created_at),
          totalQuestions: Number(row.total_questions),
          correctCount: Number(row.correct_count),
          rwScore: row.rw_score == null ? null : Number(row.rw_score),
          mathScore: row.math_score == null ? null : Number(row.math_score),
          totalScore: row.total_score == null ? null : Number(row.total_score),
          durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
          proctorAlerts: Number(row.proctor_alerts),
          questions,
        },
      });
    }

    return sendJson(res, 405, { error: 'Método no permitido' });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
