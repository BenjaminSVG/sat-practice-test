import { getDb, ensureSchema } from './_lib/db.js';
import { requireUser, sendJson } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    await ensureSchema();
    const user = await requireUser(req, res);
    if (!user) return;
    const db = getDb();

    // Todo se calcula con columnas agregadas (sin abrir questions_json).
    const r = await db.execute({
      sql: `SELECT id, title, created_at, total_questions, correct_count,
                   rw_score, math_score, total_score
            FROM attempts WHERE user_id = ? ORDER BY created_at ASC`,
      args: [user.id],
    });
    const rows = r.rows;

    const withScore = rows.filter((x) => x.total_score != null);
    const avgScore = withScore.length
      ? Math.round(withScore.reduce((a, x) => a + Number(x.total_score), 0) / withScore.length)
      : null;

    // Mejora: diferencia entre el último puntaje y el anterior.
    let lastDelta = null;
    if (withScore.length >= 2) {
      lastDelta =
        Number(withScore[withScore.length - 1].total_score) -
        Number(withScore[withScore.length - 2].total_score);
    }

    const bestRw = maxOrNull(rows.map((x) => x.rw_score));
    const bestMath = maxOrNull(rows.map((x) => x.math_score));

    let totalQ = 0,
      totalCorrect = 0;
    rows.forEach((x) => {
      totalQ += Number(x.total_questions);
      totalCorrect += Number(x.correct_count);
    });
    const accuracy = totalQ ? Math.round((totalCorrect / totalQ) * 100) : null;

    // Serie de progresión (últimos 12 intentos con puntaje).
    const progression = withScore.slice(-12).map((x) => ({
      id: Number(x.id),
      title: x.title,
      createdAt: Number(x.created_at),
      totalScore: Number(x.total_score),
    }));

    return sendJson(res, 200, {
      stats: {
        testsCompleted: rows.length,
        avgScore,
        lastDelta,
        bestRw,
        bestMath,
        accuracy,
        lastScore: withScore.length ? Number(withScore[withScore.length - 1].total_score) : null,
        progression,
      },
    });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}

function maxOrNull(arr) {
  const nums = arr.filter((v) => v != null).map(Number);
  return nums.length ? Math.max(...nums) : null;
}
