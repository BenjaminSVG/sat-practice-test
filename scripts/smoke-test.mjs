/* Smoke test: invoca los handlers reales con req/res simulados contra local.db */
import { readFileSync } from 'node:fs';

// carga .env
try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const loginH = (await import('../api/auth/login.js')).default;
const meH = (await import('../api/auth/me.js')).default;
const usersH = (await import('../api/admin/users/index.js')).default;
const attemptsH = (await import('../api/attempts/index.js')).default;
const attemptIdH = (await import('../api/attempts/[id].js')).default;
const statsH = (await import('../api/stats.js')).default;
const accountH = (await import('../api/account.js')).default;
const studentDetailH = (await import('../api/admin/student/[id].js')).default;
const mistakesH = (await import('../api/review/mistakes.js')).default;

// --- mocks HTTP ---
function mkRes() {
  const res = {
    _status: 200,
    _headers: {},
    _body: '',
    statusCode: 200,
    status(c) { this._status = c; this.statusCode = c; return this; },
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; return this; },
    getHeader(k) { return this._headers[k.toLowerCase()]; },
    end(b) { this._body = b || ''; this._done = true; },
  };
  return res;
}
function mkReq(method, body, cookie, query) {
  return { method, body, query: query || {}, headers: cookie ? { cookie } : {} };
}
function jsonOf(res) { try { return JSON.parse(res._body); } catch { return {}; } }
function cookieOf(res) {
  const sc = res.getHeader('set-cookie');
  const arr = Array.isArray(sc) ? sc : [sc];
  const m = (arr[0] || '').match(/sat_session=([^;]+)/);
  return m ? 'sat_session=' + m[1] : '';
}
let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label); } }

const ADMIN_PASS = process.argv[2];
if (!ADMIN_PASS) { console.error('Uso: node scripts/smoke-test.mjs <ADMIN_PASSWORD>'); process.exit(1); }

console.log('1) Login admin (contraseña incorrecta debe fallar)');
let res = mkRes();
await loginH(mkReq('POST', { username: 'admin', password: 'wrong' }), res);
assert(res._status === 401, 'rechaza contraseña incorrecta (401)');

console.log('2) Login admin correcto');
res = mkRes();
await loginH(mkReq('POST', { username: 'admin', password: ADMIN_PASS }), res);
assert(res._status === 200, 'login correcto (200)');
assert(jsonOf(res).user && jsonOf(res).user.role === 'admin', 'devuelve rol admin');
const adminCookie = cookieOf(res);
assert(!!adminCookie, 'setea cookie de sesión');

console.log('3) /me con cookie de admin');
res = mkRes();
await meH(mkReq('GET', undefined, adminCookie), res);
assert(jsonOf(res).user && jsonOf(res).user.username === 'admin', '/me identifica al admin');

console.log('4) Admin crea alumno');
const uname = 'alumno_test_' + (jsonOf(res).user.id) + '_' + Math.floor(process.hrtime()[1] % 100000);
res = mkRes();
await usersH(mkReq('POST', { username: uname, password: 'clave123', displayName: 'Alumno Test' }, adminCookie), res);
assert(res._status === 201, 'crea alumno (201)');

console.log('5) Un no-admin no puede listar usuarios');
res = mkRes();
await loginH(mkReq('POST', { username: uname, password: 'clave123' }), res);
const studentCookie = cookieOf(res);
assert(res._status === 200 && !!studentCookie, 'login del alumno ok');
res = mkRes();
await usersH(mkReq('GET', undefined, studentCookie), res);
assert(res._status === 403, 'alumno recibe 403 al listar usuarios');

console.log('6) Alumno guarda un intento');
const questions = [
  { id: 'q1', section: 'rw', stem: 'x', prompt: 'x', choices: [{letter:'A',text:'a'}], correct: 'A', isSPR: false, userAnswer: 'A', isCorrect: true },
  { id: 'q2', section: 'rw', stem: 'y', prompt: 'y', choices: [{letter:'A',text:'a'}], correct: 'B', isSPR: false, userAnswer: 'A', isCorrect: false },
  { id: 'q3', section: 'math', stem: 'z', prompt: 'z', choices: [], correct: '5', isSPR: true, userAnswer: '5', isCorrect: true },
  { id: 'q4', section: 'math', stem: 'w', prompt: 'w', choices: [], correct: '7', isSPR: true, userAnswer: '7', isCorrect: true },
];
res = mkRes();
await attemptsH(mkReq('POST', { title: 'Test smoke', mode: 'quick', durationSeconds: 120, proctorAlerts: 2, questions }, studentCookie), res);
assert(res._status === 201, 'guarda intento (201)');
const body6 = jsonOf(res);
const attemptId = body6.id;
assert(body6.stats.correct === 3 && body6.stats.total === 4, 'cuenta 3/4 correctas');
assert(body6.stats.rwScore != null && body6.stats.mathScore != null, 'calcula puntajes RW y Math');
assert(body6.stats.mathScore === 800, 'Math 2/2 → 800');

console.log('7) Alumno lista sus intentos');
res = mkRes();
await attemptsH(mkReq('GET', undefined, studentCookie), res);
assert(jsonOf(res).attempts.length >= 1, 'lista al menos 1 intento');

console.log('8) Alumno obtiene el intento completo (con preguntas)');
res = mkRes();
await attemptIdH(mkReq('GET', undefined, studentCookie, { id: String(attemptId) }), res);
assert(jsonOf(res).attempt && jsonOf(res).attempt.questions.length === 4, 'recupera 4 preguntas para revisar/rehacer');
assert(jsonOf(res).attempt.proctorAlerts === 2, 'conserva nº de alertas de cámara');

console.log('9) Stats del alumno');
res = mkRes();
await statsH(mkReq('GET', undefined, studentCookie), res);
const st = jsonOf(res).stats;
assert(st.testsCompleted >= 1, 'stats: testsCompleted >= 1');
assert(st.accuracy === 75, 'stats: precisión 3/4 = 75%');

console.log('10) Otro alumno NO puede ver el intento ajeno');
res = mkRes();
const u2 = uname + '_b';
await usersH(mkReq('POST', { username: u2, password: 'clave123', displayName: 'Otro' }, adminCookie), res);
res = mkRes();
await loginH(mkReq('POST', { username: u2, password: 'clave123' }), res);
const other = cookieOf(res);
res = mkRes();
await attemptIdH(mkReq('GET', undefined, other, { id: String(attemptId) }), res);
assert(res._status === 403, 'intento ajeno → 403');

console.log('11) Cuenta: el alumno cambia nombre y contraseña');
res = mkRes();
await accountH(mkReq('PATCH', { displayName: 'Alumno Renombrado', currentPassword: 'clave123', newPassword: 'clave456' }, studentCookie), res);
assert(res._status === 200, 'account: cambia nombre + contraseña (200)');
res = mkRes();
await accountH(mkReq('PATCH', { currentPassword: 'incorrecta', newPassword: 'zzzzzz' }, studentCookie), res);
assert(res._status === 403, 'account: rechaza contraseña actual incorrecta (403)');
res = mkRes();
await loginH(mkReq('POST', { username: uname, password: 'clave123' }), res);
assert(res._status === 401, 'la contraseña vieja ya no funciona');
res = mkRes();
await loginH(mkReq('POST', { username: uname, password: 'clave456' }), res);
assert(res._status === 200, 'la contraseña nueva funciona');
const studentCookie2 = cookieOf(res);

console.log('12) Panel del profesor: lista con promedio y precisión');
res = mkRes();
await usersH(mkReq('GET', undefined, adminCookie), res);
const list = jsonOf(res).users;
const stu = list.find((u) => u.username === uname);
assert(stu && 'avgScore' in stu && 'accuracy' in stu, 'admin list incluye avgScore y accuracy');

console.log('13) Detalle de alumno (profesor)');
res = mkRes();
await studentDetailH(mkReq('GET', undefined, adminCookie, { id: String(stu.id) }), res);
const det = jsonOf(res);
assert(res._status === 200 && det.student && det.stats && Array.isArray(det.attempts), 'detalle de alumno OK');
assert(det.attempts.length >= 1, 'detalle incluye intentos');
res = mkRes();
await studentDetailH(mkReq('GET', undefined, studentCookie2, { id: String(stu.id) }), res);
assert(res._status === 403, 'un alumno NO puede ver el detalle (403)');

console.log('14) Repaso de errores');
res = mkRes();
await mistakesH(mkReq('GET', undefined, studentCookie2, {}), res);
const mk = jsonOf(res);
assert(res._status === 200 && Array.isArray(mk.questions), 'mistakes devuelve preguntas');
assert(mk.questions.some((q) => q.id === 'q2'), 'incluye la pregunta fallada (q2)');
assert(!mk.questions.some((q) => q.id === 'q1'), 'NO incluye la correcta (q1)');
assert(!mk.questions.some((q) => 'isCorrect' in q), 'quita el veredicto para practicar');

console.log(`\nRESULTADO: ${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
