/* ==========================================================================
   scoring.js (backend) — Conversión de puntaje estilo SAT digital.

   El SAT digital NO usa un porcentaje lineal: convierte el "raw score" (número
   de aciertos) a una escala 200–800 mediante una tabla de equating con forma de
   curva. Estas tablas reproducen la forma de las tablas oficiales de conversión
   de los exámenes de práctica digitales del College Board (Reading & Writing
   sobre 54 preguntas, Math sobre 44). La escala oficial exacta varía por forma
   del examen (equating), así que esto es una aproximación fiel a la curva real,
   no la tabla secreta de un examen concreto.

   IMPORTANTE: este archivo debe mantenerse idéntico en lógica a js/scoring.js
   (versión de navegador) para que el puntaje mostrado al terminar y el que se
   guarda en la base de datos coincidan. Lo verifica scripts/test-scoring.mjs.
   ========================================================================== */

// Tabla Reading & Writing: índice = aciertos (0..54), valor = puntaje escalado.
export const RW_TABLE = [
  200, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330,
  340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480,
  490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 640,
  650, 660, 670, 690, 700, 720, 740, 760, 780, 800,
];

// Tabla Math: índice = aciertos (0..44), valor = puntaje escalado.
export const MATH_TABLE = [
  200, 200, 210, 220, 240, 250, 270, 290, 300, 320, 340, 350, 370, 390, 400,
  420, 430, 450, 460, 480, 490, 510, 520, 540, 550, 560, 580, 590, 600, 610,
  630, 640, 650, 660, 680, 690, 700, 710, 730, 740, 760, 770, 780, 790, 800,
];

// Convierte aciertos/total de una sección a la escala 200–800 usando la tabla
// oficial. Para exámenes parciales (menos preguntas que la sección completa),
// proyecta los aciertos al "raw equivalente" de la sección completa y luego
// interpola en la tabla; así un 8/10 se escala como el SAT escalaría ~43/54.
export function scaleSection(section, correct, total) {
  if (!total) return null;
  const table = section === 'math' ? MATH_TABLE : RW_TABLE;
  const full = table.length - 1; // 44 (math) o 54 (rw)
  const c = Math.max(0, Math.min(correct, total));
  const rawEq = (c / total) * full; // puede ser fraccionario
  const lo = Math.floor(rawEq);
  const hi = Math.ceil(rawEq);
  const val = lo === hi ? table[lo] : table[lo] + (table[hi] - table[lo]) * (rawEq - lo);
  return Math.round(val / 10) * 10; // el SAT reporta en múltiplos de 10
}

// Puntajes por sección + total (400–1600). Si solo se practicó una sección, se
// estima el total ×2 (como referencia; el SAT real necesita ambas secciones).
export function computeScores({ rwCorrect, rwTotal, mathCorrect, mathTotal }) {
  const rwScore = scaleSection('rw', rwCorrect, rwTotal);
  const mathScore = scaleSection('math', mathCorrect, mathTotal);
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
