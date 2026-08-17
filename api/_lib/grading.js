/* ==========================================================================
   api/_lib/grading.js — Recalifica cada pregunta en el SERVIDOR a partir de
   userAnswer + correct, en vez de confiar en el campo isCorrect que manda el
   navegador. Sin esto, cualquiera podría llamar a la API directamente (sin
   pasar por la interfaz del examen) y mandar isCorrect:true en cada pregunta
   para forjar un puntaje perfecto. Debe reproducir EXACTAMENTE la lógica de
   isCorrect()/normalizeSPR()/evalNum() de js/app.js para que el resultado
   coincida con lo que el alumno vio en pantalla.
   ========================================================================== */

function normalizeSPR(v) {
  return (v || '').toString().trim().toLowerCase().replace(/\s+/g, '');
}

function evalNum(s) {
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const f = s.match(/^(-?\d+)\/(\d+)$/);
  if (f) return parseInt(f[1], 10) / parseInt(f[2], 10);
  return null;
}

export function isQuestionCorrect(q) {
  const a = q && q.userAnswer;
  if (a === undefined || a === null || a === '') return false;
  const choices = Array.isArray(q.choices) ? q.choices : [];
  if (q.isSPR || choices.length === 0) {
    const ans = normalizeSPR(a);
    const correct = normalizeSPR(q.correct);
    if (!correct) return false;
    if (ans === correct) return true;
    const va = evalNum(ans);
    const vc = evalNum(correct);
    return va !== null && vc !== null && Math.abs(va - vc) < 1e-6;
  }
  return String(a).toUpperCase() === String(q.correct || '').toUpperCase();
}

// Devuelve una copia de las preguntas con isCorrect recalculado en el servidor
// (fuente de verdad). Se usa antes de guardar, puntuar o desglosar por tema.
export function regradeQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).map((q) => ({
    ...q,
    isCorrect: isQuestionCorrect(q),
  }));
}
