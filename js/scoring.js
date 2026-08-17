/* ==========================================================================
   scoring.js (navegador) — Conversión de puntaje estilo SAT digital.
   Expone window.SATScoring. Debe mantenerse idéntico en lógica a
   api/_lib/scoring.js (backend). Lo verifica scripts/test-scoring.mjs.

   El SAT digital convierte el número de aciertos a una escala 200–800 mediante
   una tabla de equating con forma de curva (no un porcentaje lineal). Estas
   tablas reproducen la forma de las tablas oficiales de conversión de los
   exámenes de práctica digitales del College Board (R&W sobre 54, Math sobre 44).
   ========================================================================== */

(function () {
  'use strict';

  // Tabla Reading & Writing: índice = aciertos (0..54), valor = puntaje escalado.
  const RW_TABLE = [
    200, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330,
    340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480,
    490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 640,
    650, 660, 670, 690, 700, 720, 740, 760, 780, 800,
  ];

  // Tabla Math: índice = aciertos (0..44), valor = puntaje escalado.
  const MATH_TABLE = [
    200, 200, 210, 220, 240, 250, 270, 290, 300, 320, 340, 350, 370, 390, 400,
    420, 430, 450, 460, 480, 490, 510, 520, 540, 550, 560, 580, 590, 600, 610,
    630, 640, 650, 660, 680, 690, 700, 710, 730, 740, 760, 770, 780, 790, 800,
  ];

  function scaleSection(section, correct, total) {
    if (!total) return null;
    const table = section === 'math' ? MATH_TABLE : RW_TABLE;
    const full = table.length - 1;
    const c = Math.max(0, Math.min(correct, total));
    const rawEq = (c / total) * full;
    const lo = Math.floor(rawEq);
    const hi = Math.ceil(rawEq);
    const val = lo === hi ? table[lo] : table[lo] + (table[hi] - table[lo]) * (rawEq - lo);
    return Math.round(val / 10) * 10;
  }

  function computeScores(o) {
    const rwScore = scaleSection('rw', o.rwCorrect, o.rwTotal);
    const mathScore = scaleSection('math', o.mathCorrect, o.mathTotal);
    let totalScore = null;
    let totalEstimated = false;
    if (rwScore != null && mathScore != null) totalScore = rwScore + mathScore;
    else if (rwScore != null) {
      totalScore = rwScore * 2;
      totalEstimated = true;
    } else if (mathScore != null) {
      totalScore = mathScore * 2;
      totalEstimated = true;
    }
    return { rwScore, mathScore, totalScore, totalEstimated };
  }

  window.SATScoring = { scaleSection, computeScores, RW_TABLE, MATH_TABLE };
})();
