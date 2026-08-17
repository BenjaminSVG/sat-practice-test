/* Verifica que TODA clase Tailwind usada en index.html y js/portal.js exista en
   el CSS compilado (css/tailwind.css). Si falta alguna, sería una regresión
   visual al haber quitado el Play CDN. */
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const tw = readFileSync(new URL('css/tailwind.css', root), 'utf8');
const custom =
  readFileSync(new URL('css/styles.css', root), 'utf8') + readFileSync(new URL('css/dark.css', root), 'utf8');
const sources = ['index.html', 'js/portal.js'].map((f) => readFileSync(new URL(f, root), 'utf8'));

// Extrae el contenido de todos los atributos class="..."
const classAttrs = [];
for (const src of sources) {
  const re = /class="([^"]*)"/g;
  let m;
  while ((m = re.exec(src))) classAttrs.push(m[1]);
}

// Prefijos/tokens de clases propias (definidas en styles.css), no de Tailwind.
const isCustom = (t) =>
  /^(bb-|choice|result|sr-|gc-|guide|mode-|dropzone|opt-|real-|random-|slot-|import-|login|nav-link|nav-link-m|proctor|camera-|sat-|review-|break-|results-|hl$|hl-|blank|crossout|letter-btn|navcell|toast|spr|fb-|drag|hidden-time|marked|single|active|screen|bank-badge|flag|abc|lg$|lg-)/.test(
    t
  ) || custom.includes('.' + t.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c));

// ¿Existe la clase (como selector) en el CSS compilado? Respeta el escape de
// Tailwind (`:` → `\:`, `/` → `\/`) y exige límite de token.
function inCss(css, token) {
  const needle = '.' + token.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
  let idx = css.indexOf(needle);
  while (idx >= 0) {
    const after = css[idx + needle.length];
    if (after === undefined || !/[a-zA-Z0-9_-]/.test(after)) return true;
    idx = css.indexOf(needle, idx + 1);
  }
  return false;
}

const tokens = new Set();
for (const attr of classAttrs) {
  for (let t of attr.split(/\s+/)) {
    t = t.replace(/^['"`]+|['"`]+$/g, ''); // quita comillas de ternarios en JS
    if (!t || t.includes('${') || t.includes('{') || t.includes('}')) continue; // dinámicas
    if (!/^[a-zA-Z]/.test(t)) continue; // descarta operadores/números (:, >=, ?, 0)
    tokens.add(t);
  }
}

const missing = [];
for (const t of tokens) {
  if (isCustom(t)) continue;
  if (!inCss(tw, t)) missing.push(t);
}

console.log(`Clases Tailwind revisadas: ${tokens.size}`);
if (missing.length) {
  console.log(`✗ FALTAN en el CSS compilado (${missing.length}):`);
  console.log('   ' + missing.sort().join('  '));
  process.exit(1);
} else {
  console.log('✓ Todas las clases Tailwind usadas están en el CSS compilado.');
}
