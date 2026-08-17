import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = [
  'screen-login', 'screen-portal', 'login-form', 'login-username', 'login-password',
  'login-error', 'login-submit', 'nav-username', 'nav-avatar', 'nav-admin', 'nav-admin-m',
  'nav-logout', 'view-dashboard', 'view-exams', 'view-import', 'view-admin',
  'dashboard-root', 'exams-root', 'admin-root', 'btn-to-dashboard', 'results-saved-note',
  'opt-camera-monitor', 'proctor-widget', 'proctor-video', 'proctor-status', 'dropzone',
  'file-input', 'btn-start', 'btn-demo', 'btn-start-real', 'btn-random-start', 'guide-grid',
  'bank-badge', 'screen-test', 'screen-results', 'results-ring', 'sat-scorecard', 'results-list',
];
const miss = ids.filter((id) => !html.includes(`id="${id}"`));
console.log(miss.length ? '✗ FALTAN IDs: ' + miss.join(', ') : `✓ Todos los IDs referenciados existen (${ids.length})`);

for (const tag of ['section', 'main', 'header', 'footer', 'form']) {
  const o = (html.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
  const c = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  console.log(`${tag}: ${o} abiertas / ${c} cerradas ${o === c ? '✓' : '✗'}`);
}
process.exit(miss.length ? 1 : 0);
