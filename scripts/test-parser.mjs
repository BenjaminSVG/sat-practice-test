/* Ejecuta el parser real (js/pdf-parser.js) contra un PDF del Question Bank en
   Node, para verificar qué preguntas de R&W se detectan como figura (needsImage).
   Uso: node scripts/test-parser.mjs "questionbank-export-2026-7-1.pdf" */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Uso: node scripts/test-parser.mjs <ruta.pdf>');
  process.exit(1);
}

// Shim de document (canvas) — solo lo usa renderRegion, que aquí no se llama.
const documentShim = {
  createElement: () => ({
    getContext: () => ({ drawImage() {} }),
    toDataURL: () => '',
    width: 0,
    height: 0,
  }),
};
const win = { pdfjsLib: pdfjs };
const context = { window: win, document: documentShim, setTimeout, clearTimeout, console };
vm.createContext(context);

const code = readFileSync(new URL('../js/pdf-parser.js', import.meta.url), 'utf8');
vm.runInContext(code, context);

// En Node usamos el "fake worker" (hilo principal). Como el parser ahora fija
// workerSrc al CDN dentro de ensurePdfjs(), forzamos que siempre lea '' aquí.
Object.defineProperty(pdfjs.GlobalWorkerOptions, 'workerSrc', {
  configurable: true,
  get: () => '',
  set: () => {},
});

const buf = readFileSync(fileURLToPath(new URL('../' + pdfPath, import.meta.url)));
const data = new Uint8Array(buf);

const questions = await win.SATParser.parsePDF(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), pdfPath);

const rw = questions.filter((q) => q.section === 'rw');
const rwFig = rw.filter((q) => q.needsImage);
const math = questions.filter((q) => q.section === 'math');

console.log(`\nTotal preguntas: ${questions.length}  (R&W: ${rw.length}, Math: ${math.length})`);
console.log(`R&W detectadas como figura (needsImage): ${rwFig.length}\n`);

rwFig.forEach((q, i) => {
  const preview = (q.stem || '').replace(/\s+/g, ' ').slice(0, 80);
  const g = q.geom || {};
  const choiceYs = Object.values(g.choiceYs || {});
  const topChoice = choiceYs.length ? Math.max(...choiceYs) : null;
  const okCrop =
    g.figureBottom != null && topChoice != null && g.figureBottom > topChoice && g.figureBottom < g.stemTopY;
  console.log(`  [${i + 1}] id=${q.id}  choices=${q.choices.length}`);
  console.log(
    `      stemTopY=${Math.round(g.stemTopY)}  figureBottom=${Math.round(g.figureBottom)}  topChoiceY=${
      topChoice != null ? Math.round(topChoice) : 'n/a'
    }  cropExcluyeOpciones=${okCrop ? 'SÍ ✓' : 'REVISAR ✗'}`
  );
  console.log(`      opciones: ${q.choices.map((c) => c.letter + ') ' + (c.text || '').slice(0, 22)).join('  |  ')}`);
  console.log(`      "${preview}…"`);
});

// Muestra también algunas R&W NO detectadas, para revisar falsos negativos.
const rwText = rw.filter((q) => !q.needsImage);
console.log(`\nR&W como texto (muestra de ${Math.min(5, rwText.length)} de ${rwText.length}):`);
rwText.slice(0, 5).forEach((q) => {
  console.log(`   - id=${q.id}: "${(q.stem || '').replace(/\s+/g, ' ').slice(0, 70)}…"`);
});
