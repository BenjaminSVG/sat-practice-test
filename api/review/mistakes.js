import { getDb, ensureSchema } from '../_lib/db.js';
import { requireUser, sendJson } from '../_lib/auth.js';

// GET /api/review/mistakes?section=&domain=&limit=
// Devuelve las preguntas que el alumno ha respondido MAL (deduplicadas por id,
// versión más reciente), para practicarlas de nuevo. Opcionalmente filtra por
// sección y subtema (para "practicar mi tema más flojo").
export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    await ensureSchema();
    const user = await requireUser(req, res);
    if (!user) return;
    const db = getDb();

    const section = req.query.section === 'math' || req.query.section === 'rw' ? req.query.section : null;
    const domain = req.query.domain ? String(req.query.domain) : null;
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 40));

    // Revisamos los intentos más recientes (los que más importan para repasar).
    const r = await db.execute({
      sql: `SELECT questions_json FROM attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`,
      args: [user.id],
    });

    const seen = new Set();
    const out = [];
    for (const row of r.rows) {
      let qs = [];
      try {
        qs = JSON.parse(row.questions_json || '[]');
      } catch {
        qs = [];
      }
      for (const q of qs) {
        if (q.isCorrect) continue; // solo errores
        const key = (q.section || '') + '|' + (q.id || '');
        if (seen.has(key)) continue; // dedup: nos quedamos con la más reciente
        seen.add(key);
        if (section && q.section !== section) continue;
        if (domain && (q.domain || 'General') !== domain) continue;
        // Copia para práctica (sin la respuesta previa ni el veredicto).
        const c = { ...q };
        delete c.userAnswer;
        delete c.isCorrect;
        out.push(c);
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }

    return sendJson(res, 200, { questions: out, count: out.length });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
