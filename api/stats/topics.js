import { getDb, ensureSchema } from '../_lib/db.js';
import { requireUser, sendJson } from '../_lib/auth.js';
import { insertTopics } from '../_lib/topics.js';

// Nombre "bonito" de cada sección.
const SECTION_NAME = { rw: 'Reading and Writing', math: 'Math' };

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    await ensureSchema();
    const user = await requireUser(req, res);
    if (!user) return;
    const db = getDb();

    // Backfill: intentos del usuario sin filas de desglose (guardados antes de
    // existir esta funcionalidad). Se calculan una sola vez.
    const missing = await db.execute({
      sql: `SELECT a.id, a.questions_json
            FROM attempts a
            LEFT JOIN (SELECT DISTINCT attempt_id FROM attempt_topics) t ON t.attempt_id = a.id
            WHERE a.user_id = ? AND t.attempt_id IS NULL`,
      args: [user.id],
    });
    for (const row of missing.rows) {
      let qs = [];
      try {
        qs = JSON.parse(row.questions_json || '[]');
      } catch {
        qs = [];
      }
      if (qs.length) await insertTopics(db, Number(row.id), user.id, qs);
    }

    // Agregado por sección + subtema.
    const r = await db.execute({
      sql: `SELECT section, domain, SUM(total) AS total, SUM(correct) AS correct
            FROM attempt_topics WHERE user_id = ?
            GROUP BY section, domain
            ORDER BY section, total DESC`,
      args: [user.id],
    });

    const sections = {
      rw: { key: 'rw', name: SECTION_NAME.rw, total: 0, correct: 0, domains: [] },
      math: { key: 'math', name: SECTION_NAME.math, total: 0, correct: 0, domains: [] },
    };
    for (const row of r.rows) {
      const sec = row.section === 'math' ? 'math' : 'rw';
      const total = Number(row.total);
      const correct = Number(row.correct);
      sections[sec].total += total;
      sections[sec].correct += correct;
      sections[sec].domains.push({
        domain: row.domain,
        total,
        correct,
        accuracy: total ? Math.round((correct / total) * 100) : 0,
      });
    }
    const out = [];
    ['rw', 'math'].forEach((k) => {
      const s = sections[k];
      s.accuracy = s.total ? Math.round((s.correct / s.total) * 100) : null;
      if (s.total) out.push(s);
    });

    return sendJson(res, 200, { topics: out });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
