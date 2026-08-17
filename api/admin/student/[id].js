import { getDb, ensureSchema } from '../../_lib/db.js';
import { requireAdmin, sendJson } from '../../_lib/auth.js';

// GET /api/admin/student/:id — detalle de un alumno para el profesor:
// datos, estadísticas, rendimiento por tema y últimos intentos.
export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    await ensureSchema();
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id)) return sendJson(res, 400, { error: 'ID inválido' });
    const db = getDb();

    const u = await db.execute({
      sql: "SELECT id, username, display_name, active, created_at FROM users WHERE id = ? AND role = 'student'",
      args: [id],
    });
    const urow = u.rows[0];
    if (!urow) return sendJson(res, 404, { error: 'Alumno no encontrado' });

    const at = await db.execute({
      sql: `SELECT id, title, mode, created_at, total_questions, correct_count,
                   rw_score, math_score, total_score, duration_seconds, proctor_alerts
            FROM attempts WHERE user_id = ? ORDER BY created_at DESC`,
      args: [id],
    });
    const attempts = at.rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      mode: r.mode,
      createdAt: Number(r.created_at),
      totalQuestions: Number(r.total_questions),
      correctCount: Number(r.correct_count),
      rwScore: r.rw_score == null ? null : Number(r.rw_score),
      mathScore: r.math_score == null ? null : Number(r.math_score),
      totalScore: r.total_score == null ? null : Number(r.total_score),
      durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
      proctorAlerts: Number(r.proctor_alerts),
    }));

    const withScore = attempts.filter((a) => a.totalScore != null).slice().reverse(); // asc
    const avgScore = withScore.length
      ? Math.round(withScore.reduce((s, a) => s + a.totalScore, 0) / withScore.length)
      : null;
    let totalQ = 0,
      totalC = 0,
      alerts = 0;
    attempts.forEach((a) => {
      totalQ += a.totalQuestions;
      totalC += a.correctCount;
      alerts += a.proctorAlerts;
    });

    // Rendimiento por tema/subtema (misma agregación que /api/stats/topics).
    const t = await db.execute({
      sql: `SELECT section, domain, SUM(total) AS total, SUM(correct) AS correct
            FROM attempt_topics WHERE user_id = ? GROUP BY section, domain ORDER BY section, total DESC`,
      args: [id],
    });
    const SEC = { rw: 'Reading and Writing', math: 'Math' };
    const sections = { rw: { key: 'rw', name: SEC.rw, total: 0, correct: 0, domains: [] }, math: { key: 'math', name: SEC.math, total: 0, correct: 0, domains: [] } };
    for (const row of t.rows) {
      const sec = row.section === 'math' ? 'math' : 'rw';
      const total = Number(row.total);
      const correct = Number(row.correct);
      sections[sec].total += total;
      sections[sec].correct += correct;
      sections[sec].domains.push({ domain: row.domain, total, correct, accuracy: total ? Math.round((correct / total) * 100) : 0 });
    }
    const topics = [];
    ['rw', 'math'].forEach((k) => {
      const s = sections[k];
      s.accuracy = s.total ? Math.round((s.correct / s.total) * 100) : null;
      if (s.total) topics.push(s);
    });

    return sendJson(res, 200, {
      student: {
        id: Number(urow.id),
        username: urow.username,
        displayName: urow.display_name || urow.username,
        active: !!Number(urow.active),
        createdAt: Number(urow.created_at),
      },
      stats: {
        testsCompleted: attempts.length,
        avgScore,
        bestScore: withScore.length ? Math.max(...withScore.map((a) => a.totalScore)) : null,
        lastScore: withScore.length ? withScore[withScore.length - 1].totalScore : null,
        accuracy: totalQ ? Math.round((totalC / totalQ) * 100) : null,
        proctorAlerts: alerts,
        progression: withScore.slice(-12).map((a) => ({ createdAt: a.createdAt, totalScore: a.totalScore })),
      },
      topics,
      attempts,
    });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
