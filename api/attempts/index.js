import { getDb, ensureSchema } from '../_lib/db.js';
import { requireUser, sendJson, readJsonBody } from '../_lib/auth.js';
import { insertTopics } from '../_lib/topics.js';
import { computeScores } from '../_lib/scoring.js';
import { regradeQuestions } from '../_lib/grading.js';

const MAX_QUESTIONS_PER_ATTEMPT = 500; // muy por encima de cualquier combinación real del SAT

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const user = await requireUser(req, res);
    if (!user) return;
    const db = getDb();

    if (req.method === 'GET') {
      // Lista de intentos del usuario (sin el JSON pesado de preguntas).
      const r = await db.execute({
        sql: `SELECT id, title, mode, created_at, total_questions, correct_count,
                     rw_total, rw_correct, math_total, math_correct,
                     rw_score, math_score, total_score, duration_seconds, proctor_alerts
              FROM attempts WHERE user_id = ? ORDER BY created_at DESC`,
        args: [user.id],
      });
      return sendJson(res, 200, { attempts: r.rows.map(rowToSummary) });
    }

    if (req.method === 'POST') {
      const b = await readJsonBody(req);
      const rawQuestions = Array.isArray(b.questions) ? b.questions.slice(0, MAX_QUESTIONS_PER_ATTEMPT) : [];
      // Recalifica en el servidor (fuente de verdad): ignora el isCorrect que
      // manda el navegador, para que nadie pueda forjar un puntaje llamando
      // a la API directamente con isCorrect:true en cada pregunta.
      const questions = regradeQuestions(rawQuestions);
      const s = computeStats(questions);
      const now = Date.now();
      const ins = await db.execute({
        sql: `INSERT INTO attempts
                (user_id, title, mode, created_at, total_questions, correct_count,
                 rw_total, rw_correct, math_total, math_correct,
                 rw_score, math_score, total_score, duration_seconds, proctor_alerts, questions_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          user.id,
          String(b.title || 'Examen de práctica').slice(0, 160),
          String(b.mode || 'quick').slice(0, 32),
          now,
          s.total,
          s.correct,
          s.rwTotal,
          s.rwCorrect,
          s.mathTotal,
          s.mathCorrect,
          s.rwScore,
          s.mathScore,
          s.totalScore,
          Number.isFinite(b.durationSeconds) ? Math.max(0, Math.round(b.durationSeconds)) : null,
          Number.isFinite(b.proctorAlerts) ? Math.max(0, Math.round(b.proctorAlerts)) : 0,
          JSON.stringify(questions),
        ],
      });
      const attemptId = Number(ins.lastInsertRowid);
      await insertTopics(db, attemptId, user.id, questions);
      return sendJson(res, 201, { id: attemptId, stats: s });
    }

    return sendJson(res, 405, { error: 'Método no permitido' });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}

function rowToSummary(row) {
  return {
    id: Number(row.id),
    title: row.title,
    mode: row.mode,
    createdAt: Number(row.created_at),
    totalQuestions: Number(row.total_questions),
    correctCount: Number(row.correct_count),
    rwTotal: Number(row.rw_total),
    rwCorrect: Number(row.rw_correct),
    mathTotal: Number(row.math_total),
    mathCorrect: Number(row.math_correct),
    rwScore: row.rw_score == null ? null : Number(row.rw_score),
    mathScore: row.math_score == null ? null : Number(row.math_score),
    totalScore: row.total_score == null ? null : Number(row.total_score),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    proctorAlerts: Number(row.proctor_alerts),
  };
}

// Calcula estadísticas del intento en el servidor (fuente de verdad).
function computeStats(questions) {
  let correct = 0,
    rwTotal = 0,
    rwCorrect = 0,
    mathTotal = 0,
    mathCorrect = 0;
  for (const q of questions) {
    const isMath = q.section === 'math';
    if (isMath) mathTotal++;
    else rwTotal++;
    if (q.isCorrect) {
      correct++;
      if (isMath) mathCorrect++;
      else rwCorrect++;
    }
  }
  const { rwScore, mathScore, totalScore } = computeScores({
    rwCorrect,
    rwTotal,
    mathCorrect,
    mathTotal,
  });
  return {
    total: questions.length,
    correct,
    rwTotal,
    rwCorrect,
    mathTotal,
    mathCorrect,
    rwScore,
    mathScore,
    totalScore,
  };
}
