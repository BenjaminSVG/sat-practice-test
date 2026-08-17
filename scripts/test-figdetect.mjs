/* Prueba unitaria de la detección de figuras en R&W:
   1) frases típicas de preguntas con tabla/gráfico (deben detectar);
   2) preguntas de texto normales (NO deben detectar);
   3) lógica del hueco vertical (geometría) con coordenadas simuladas. */

// Réplica EXACTA de la regex de figPhrase en js/pdf-parser.js
const figPhrase =
  /\b(based on (the |data in the )?(table|graph|figure|chart|data)|data (from|in|shown in) the (table|graph|figure|chart)|uses data from|complete the (statement|table)|the (following|accompanying|data in the) (table|graph|figure|chart)|the (table|graph|figure|chart) (above|below|shown|presents|shows|indicates|displays|illustrates)|as shown in the (figure|graph|table)|according to the (table|graph|data)|(bar|line|dot) (graph|plot)|scatter\s?plot|number line)\b/i;

let pass = 0, fail = 0;
const ok = (c, l) => (c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l)));

console.log('1) Frases que SÍ deben detectar figura:');
[
  'Based on the table, which choice best describes the data?',
  'The bar graph shows the population of four cities. Which choice…',
  'According to the data, which conclusion is most supported?',
  'Which choice most effectively uses data from the graph to complete the statement?',
  'The scatterplot displays the relationship between…',
  'As shown in the figure, the value increases…',
  'The line graph above indicates a trend in…',
  'Which choice completes the statement with data from the table?',
].forEach((s) => ok(figPhrase.test(s), s.slice(0, 55) + '…'));

console.log('\n2) Preguntas de texto normales que NO deben detectar:');
[
  'Which choice best states the main idea of the text?',
  'As used in the text, what does the word "novel" most nearly mean?',
  'Which quotation from the passage best supports the claim?',
  'The author most likely includes the anecdote in order to…',
  'Which choice completes the text with the most logical transition?',
].forEach((s) => ok(!figPhrase.test(s), s.slice(0, 55) + '…'));

console.log('\n3) Lógica del hueco vertical (geometría):');
// Réplica de la lógica de computeGeom: mayor hueco entre líneas de la región.
function maxGap(ys) {
  const region = ys.slice().sort((a, b) => b - a);
  let g = 0;
  for (let i = 1; i < region.length; i++) g = Math.max(g, region[i - 1] - region[i]);
  return g;
}
// Pregunta de texto: líneas cada ~15 pts, sin huecos → gap pequeño.
const textYs = [700, 685, 670, 655, 640, 625, 610];
ok(maxGap(textYs) < 72, `texto normal: maxGap=${maxGap(textYs)} (<72, no figura)`);
// Pregunta con figura: enunciado arriba, gran banda vacía (figura), luego pregunta.
const figYs = [700, 685, 420, 405, 390]; // hueco de 685→420 = 265 pts
ok(maxGap(figYs) >= 72, `con figura: maxGap=${maxGap(figYs)} (>=72, es figura)`);

console.log(`\nRESULTADO: ${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
