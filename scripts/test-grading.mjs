/* Verifica api/_lib/grading.js: que la recalificación en el servidor coincida
   con la lógica real del examen (js/app.js: isCorrect/normalizeSPR/evalNum),
   y que un cliente malicioso no pueda forjar isCorrect:true. */
import { isQuestionCorrect, regradeQuestions } from '../api/_lib/grading.js';

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label); } }

console.log('1) Opción múltiple');
assert(isQuestionCorrect({ correct: 'B', userAnswer: 'B', choices: [{ letter: 'A' }, { letter: 'B' }] }) === true, 'letra correcta → true');
assert(isQuestionCorrect({ correct: 'B', userAnswer: 'b', choices: [{ letter: 'A' }, { letter: 'B' }] }) === true, 'insensible a mayúsculas');
assert(isQuestionCorrect({ correct: 'B', userAnswer: 'A', choices: [{ letter: 'A' }, { letter: 'B' }] }) === false, 'letra incorrecta → false');
assert(isQuestionCorrect({ correct: 'B', userAnswer: undefined, choices: [{ letter: 'A' }, { letter: 'B' }] }) === false, 'sin responder → false');

console.log('2) Respuesta libre (SPR)');
assert(isQuestionCorrect({ isSPR: true, correct: '3.5', userAnswer: '3.5' }) === true, 'coincidencia exacta');
assert(isQuestionCorrect({ isSPR: true, correct: '7/2', userAnswer: '3.5' }) === true, 'fracción == decimal equivalente');
assert(isQuestionCorrect({ isSPR: true, correct: '3.5', userAnswer: '3.6' }) === false, 'valor numérico distinto → false');
assert(isQuestionCorrect({ isSPR: true, correct: '5', userAnswer: ' 5 ' }) === true, 'espacios ignorados');

console.log('3) El isCorrect que manda el cliente se IGNORA por completo');
const forged = [
  { correct: 'A', userAnswer: 'B', isCorrect: true, choices: [{ letter: 'A' }, { letter: 'B' }] }, // mintiendo
  { isSPR: true, correct: '10', userAnswer: 'nope', isCorrect: true }, // mintiendo
];
const regraded = regradeQuestions(forged);
assert(regraded[0].isCorrect === false, 'pregunta 1 forjada → recalificada como incorrecta');
assert(regraded[1].isCorrect === false, 'pregunta 2 forjada → recalificada como incorrecta');
assert(regraded.every((q) => q.isCorrect === false), 'ningún isCorrect:true forjado sobrevive a la recalificación');

console.log('4) Preguntas legítimas se califican bien tras regradeQuestions');
const real = [
  { correct: 'C', userAnswer: 'C', isCorrect: false, choices: [{ letter: 'A' }, { letter: 'C' }] }, // cliente se equivocó al marcar isCorrect
  { isSPR: true, correct: '2', userAnswer: '2', isCorrect: false },
];
const regraded2 = regradeQuestions(real);
assert(regraded2[0].isCorrect === true, 'servidor corrige isCorrect mal calculado (falso negativo) → true');
assert(regraded2[1].isCorrect === true, 'SPR correcto se reconoce aunque el cliente mandara false');

console.log(`\nRESULTADO: ${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
