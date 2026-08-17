/* Verifica el módulo de puntaje:
   1) Las tablas de conversión tienen la forma correcta (200→800, monótonas).
   2) La versión de navegador (js/scoring.js) y la de backend (api/_lib/scoring.js)
      producen resultados IDÉNTICOS para muchos casos (deben mantenerse sincronizadas).
   3) Casos representativos de escala.
*/
import { readFileSync } from 'node:fs';
import * as backend from '../api/_lib/scoring.js';

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label); } }

// Carga js/scoring.js (IIFE que setea window.SATScoring) en un window falso.
const browserSrc = readFileSync(new URL('../js/scoring.js', import.meta.url), 'utf8');
const fakeWindow = {};
new Function('window', browserSrc)(fakeWindow);
const browser = fakeWindow.SATScoring;

console.log('1) Forma de las tablas');
for (const [name, table, full] of [['RW', backend.RW_TABLE, 54], ['Math', backend.MATH_TABLE, 44]]) {
  assert(table.length === full + 1, `${name}: ${full + 1} entradas (0..${full})`);
  assert(table[0] === 200, `${name}: raw 0 → 200`);
  assert(table[full] === 800, `${name}: raw ${full} → 800`);
  let mono = true;
  for (let i = 1; i < table.length; i++) if (table[i] < table[i - 1]) mono = false;
  assert(mono, `${name}: monótona no decreciente`);
  let inRange = true;
  for (const v of table) if (v < 200 || v > 800 || v % 10 !== 0) inRange = false;
  assert(inRange, `${name}: todos en 200–800 y múltiplos de 10`);
}

console.log('2) Backend y navegador coinciden (sincronía)');
let mismatches = 0;
for (const section of ['rw', 'math']) {
  for (let total = 1; total <= 60; total++) {
    for (let correct = 0; correct <= total; correct++) {
      const a = backend.scaleSection(section, correct, total);
      const b = browser.scaleSection(section, correct, total);
      if (a !== b) mismatches++;
    }
  }
}
assert(mismatches === 0, `scaleSection idéntico en ${'≈'}5000 casos (backend == navegador)`);

console.log('3) Casos representativos');
assert(backend.scaleSection('math', 44, 44) === 800, 'Math 44/44 → 800');
assert(backend.scaleSection('rw', 54, 54) === 800, 'R&W 54/54 → 800');
assert(backend.scaleSection('math', 0, 44) === 200, 'Math 0/44 → 200');
assert(backend.scaleSection('math', 22, 44) >= 490 && backend.scaleSection('math', 22, 44) <= 540, 'Math 22/44 ~ mitad');
assert(backend.scaleSection('rw', 8, 10) === backend.scaleSection('rw', Math.round((8 / 10) * 54), 54), 'parcial 8/10 ≈ raw equivalente sobre 54');
assert(backend.scaleSection('math', 2, 2) === 800, 'parcial 2/2 → 800 (perfecto)');

const s = backend.computeScores({ rwCorrect: 27, rwTotal: 54, mathCorrect: 22, mathTotal: 44 });
assert(s.rwScore != null && s.mathScore != null && s.totalScore === s.rwScore + s.mathScore, 'computeScores suma ambas secciones');
assert(s.totalScore >= 400 && s.totalScore <= 1600, 'total en 400–1600');
const only = backend.computeScores({ rwCorrect: 5, rwTotal: 10, mathCorrect: 0, mathTotal: 0 });
assert(only.mathScore === null && only.totalEstimated === true, 'solo una sección → total estimado ×2');

console.log(`\nRESULTADO: ${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
