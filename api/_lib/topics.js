/* ==========================================================================
   api/_lib/topics.js — Desglose de un conjunto de preguntas por tema (section)
   y subtema (domain). Compartido por el guardado y el backfill.
   ========================================================================== */

export function computeTopics(questions) {
  const map = {};
  for (const q of questions || []) {
    const section = q.section === 'math' ? 'math' : 'rw';
    const domain = (q.domain && String(q.domain).trim()) || 'General';
    const key = section + '|' + domain;
    if (!map[key]) map[key] = { section, domain, total: 0, correct: 0 };
    map[key].total++;
    if (q.isCorrect) map[key].correct++;
  }
  return Object.values(map);
}

// Inserta las filas de desglose para un intento (batch de escritura).
export async function insertTopics(db, attemptId, userId, questions) {
  const topics = computeTopics(questions);
  if (!topics.length) return;
  await db.batch(
    topics.map((t) => ({
      sql: `INSERT INTO attempt_topics (attempt_id, user_id, section, domain, total, correct)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [attemptId, userId, t.section, t.domain, t.total, t.correct],
    })),
    'write'
  );
}
