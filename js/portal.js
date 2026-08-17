/* ==========================================================================
   portal.js — Portal del alumno/admin: login, navegación, dashboard,
   historial de exámenes (revisar / rehacer) y administración de cuentas.
   Se apoya en window.API (backend) y window.__app (motor del examen).
   ========================================================================== */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const showScreen = (name) => window.__show && window.__show(name);
  let currentUser = null;

  /* ---------------- Utilidades de formato ---------------- */
  const esc = (s) =>
    (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function fmtDate(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return '—';
    }
  }
  function fmtDuration(sec) {
    if (!sec && sec !== 0) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
  }
  const MODE_LABEL = {
    quick: 'Práctica rápida',
    demo: 'Demostración',
    realistic: 'Test realista',
    random: 'Aleatorio',
    redo: 'Repetición',
    review: 'Revisión',
  };

  /* ---------------- Navegación entre vistas ---------------- */
  const VIEWS = ['dashboard', 'exams', 'import', 'learn', 'admin'];
  function goView(view) {
    // Al volver al portal (fin del examen o salir de él), apaga la cámara.
    if (window.__stopProctor) window.__stopProctor();
    showScreen('portal');
    VIEWS.forEach((v) => {
      const el = $('view-' + v);
      if (el) el.hidden = v !== view;
    });
    document.querySelectorAll('.nav-link, .nav-link-m').forEach((a) => {
      a.classList.toggle('active', a.dataset.view === view);
    });
    window.scrollTo(0, 0);
    if (view === 'dashboard') loadDashboard();
    else if (view === 'exams') loadExams();
    else if (view === 'admin') loadAdmin();
    else if (view === 'import') loadImportBank();
    else if (view === 'learn' && window.__learn) window.__learn.render();
  }

  /* ---------------- Banco de "Examen aleatorio" con exámenes anteriores ----------------
     El banco local (js/app.js) solo se llena con los PDF importados en esta sesión.
     Para que "Examen aleatorio" también pueda usar preguntas de exámenes ya guardados,
     se trae el detalle completo (con preguntas) de cada intento pasado y se agrega al
     banco. Se hace una sola vez por sesión de portal (perezoso, al entrar a Importar). */
  let historyBankLoaded = false;
  async function loadImportBank() {
    if (historyBankLoaded || !window.__app || !window.__app.addToBank) return;
    historyBankLoaded = true;
    const badge = $('bank-badge');
    try {
      const { attempts } = await API.listAttempts();
      if (!attempts || !attempts.length) return;
      if (badge) badge.textContent = 'Cargando preguntas de exámenes anteriores…';
      const details = await Promise.all(attempts.map((a) => API.getAttempt(a.id).catch(() => null)));
      details.forEach((d) => {
        if (d && d.attempt && Array.isArray(d.attempt.questions)) {
          // Las preguntas guardadas traen la imagen ya renderizada en `img` (base64);
          // el motor del examen espera esa imagen cacheada en `_img` (sin `geom`/`srcId`
          // porque el PDF original ya no está en memoria).
          const qs = d.attempt.questions.map((q) => {
            const out = { ...q };
            if (q.img) out._img = q.img;
            return out;
          });
          window.__app.addToBank(qs);
        }
      });
      if (window.__app.updateBankBadge) window.__app.updateBankBadge();
    } catch (err) {
      console.error('No se pudo cargar el banco de exámenes anteriores', err);
      historyBankLoaded = false; // permite reintentar en la próxima visita
    }
  }

  document.querySelectorAll('.nav-link, .nav-link-m').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      goView(a.dataset.view);
    });
  });

  /* ---------------- Autenticación ---------------- */
  // En modo local no hay cuentas: se oculta cerrar sesión y el cambio de contraseña.
  let localMode = false;

  function showLogin() {
    currentUser = null;
    showScreen('login');
  }

  function enterApp(user) {
    currentUser = user;
    $('nav-username').textContent = user.displayName || user.username;
    $('nav-avatar').textContent = (user.displayName || user.username || '?').trim().charAt(0).toUpperCase();
    $('nav-logout').hidden = localMode;
    const isAdmin = user.role === 'admin';
    $('nav-admin').hidden = !isAdmin;
    const nam = $('nav-admin-m');
    if (nam) nam.hidden = !isAdmin;
    goView('dashboard');
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('login-submit');
    const err = $('login-error');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      const { user } = await window.API.login($('login-username').value.trim(), $('login-password').value);
      $('login-password').value = '';
      enterApp(user);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message || 'No se pudo iniciar sesión';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });

  $('nav-logout').addEventListener('click', async () => {
    const ok = await window.__confirm({
      title: 'Cerrar sesión',
      message: '¿Seguro que quieres cerrar sesión?',
      confirmText: 'Cerrar sesión',
      cancelText: 'Cancelar',
      icon: '🚪',
    });
    if (!ok) return;
    try {
      await window.API.logout();
    } catch (_) {
      /* ignora */
    }
    showLogin();
  });

  /* ---------------- Perfil (cambiar nombre / contraseña) ---------------- */
  function openProfile() {
    if (!currentUser) return;
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'portal-modal-overlay';
    overlay.id = 'profile-modal';
    overlay.innerHTML = `
      <div class="portal-modal">
        <div class="portal-modal-head">
          <h2>Mi perfil</h2>
          <button class="portal-modal-close" aria-label="Cerrar">&times;</button>
        </div>
        <div class="portal-modal-body">
          <label class="pm-field">
            <span>Nombre visible</span>
            <input type="text" id="pf-name" value="${esc(currentUser.displayName || '')}" />
          </label>
          ${localMode ? '' : `
          <div class="pm-sep">Cambiar contraseña <small>(opcional)</small></div>
          <label class="pm-field">
            <span>Contraseña actual</span>
            <input type="password" id="pf-cur" autocomplete="current-password" placeholder="••••••" />
          </label>
          <label class="pm-field">
            <span>Nueva contraseña</span>
            <input type="password" id="pf-new" autocomplete="new-password" placeholder="mín. 6 caracteres" />
          </label>
          <label class="pm-field">
            <span>Repetir nueva contraseña</span>
            <input type="password" id="pf-new2" autocomplete="new-password" />
          </label>`}
          <div class="pm-error" id="pf-error" hidden></div>
          <div class="pm-ok" id="pf-ok" hidden></div>
        </div>
        <div class="portal-modal-foot">
          <button class="btn-outline sm" id="pf-cancel">Cancelar</button>
          <button class="btn-primary sm" id="pf-save">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.portal-modal-close') || e.target.id === 'pf-cancel') {
        closeModal();
      }
    });
    $('pf-save').addEventListener('click', saveProfile);
  }

  async function saveProfile() {
    const err = $('pf-error');
    const ok = $('pf-ok');
    err.hidden = true;
    ok.hidden = true;
    const displayName = $('pf-name').value.trim();
    const cur = localMode ? '' : $('pf-cur').value;
    const np = localMode ? '' : $('pf-new').value;
    const np2 = localMode ? '' : $('pf-new2').value;
    const payload = {};
    if (displayName && displayName !== currentUser.displayName) payload.displayName = displayName;
    if (np || np2 || cur) {
      if (np.length < 6) return showPfError('La nueva contraseña debe tener al menos 6 caracteres.');
      if (np !== np2) return showPfError('Las contraseñas nuevas no coinciden.');
      if (!cur) return showPfError('Escribe tu contraseña actual.');
      payload.currentPassword = cur;
      payload.newPassword = np;
    }
    if (!Object.keys(payload).length) return showPfError('No hay cambios que guardar.');
    const btn = $('pf-save');
    btn.disabled = true;
    try {
      const r = await window.API.updateAccount(payload);
      currentUser.displayName = r.displayName || currentUser.displayName;
      $('nav-username').textContent = currentUser.displayName;
      $('nav-avatar').textContent = (currentUser.displayName || '?').trim().charAt(0).toUpperCase();
      ok.hidden = false;
      ok.textContent = payload.newPassword ? '✅ Cambios guardados. Contraseña actualizada.' : '✅ Cambios guardados.';
      if (!localMode) $('pf-cur').value = $('pf-new').value = $('pf-new2').value = '';
    } catch (ex) {
      showPfError(ex.message);
    } finally {
      btn.disabled = false;
    }
  }
  function showPfError(msg) {
    const err = $('pf-error');
    err.hidden = false;
    err.textContent = msg;
  }
  function closeModal() {
    const m = $('profile-modal');
    if (m) m.remove();
  }

  /* ---------------- Tema claro / oscuro ---------------- */
  function isDark() {
    return document.documentElement.classList.contains('dark');
  }
  function updateThemeIcons() {
    const icon = isDark() ? 'light_mode' : 'dark_mode';
    ['nav-theme', 'login-theme'].forEach((id) => {
      const b = $(id);
      if (b) {
        const s = b.querySelector('.material-symbols-outlined');
        if (s) s.textContent = icon;
      }
    });
  }
  function toggleTheme() {
    const dark = !isDark();
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch (_) {
      /* almacenamiento no disponible */
    }
    updateThemeIcons();
  }
  ['nav-theme', 'login-theme'].forEach((id) => {
    const b = $(id);
    if (b) b.addEventListener('click', toggleTheme);
  });
  updateThemeIcons();

  const navAvatar = $('nav-avatar');
  if (navAvatar) {
    navAvatar.style.cursor = 'pointer';
    navAvatar.title = 'Mi perfil';
    navAvatar.addEventListener('click', openProfile);
  }
  const navUser = $('nav-username');
  if (navUser) {
    navUser.style.cursor = 'pointer';
    navUser.addEventListener('click', openProfile);
  }

  /* ---------------- Componentes HTML compartidos ---------------- */
  const CARD = 'bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm';
  function loadingBox() {
    return `<div class="${CARD} p-10 text-center text-on-surface-variant">Cargando…</div>`;
  }
  function errorBox(msg) {
    return `<div class="${CARD} p-8 text-center text-error">⚠️ ${esc(msg)}</div>`;
  }
  function scorePill(score) {
    if (score == null) return '<span class="text-on-surface-variant">—</span>';
    return `<span class="font-bold text-primary">${score}</span>`;
  }

  /* ---------------- DASHBOARD ---------------- */
  async function loadDashboard() {
    const root = $('dashboard-root');
    root.innerHTML = loadingBox();
    let stats, attempts, topics;
    try {
      const [s, a, t] = await Promise.all([
        window.API.stats(),
        window.API.listAttempts(),
        window.API.topics(),
      ]);
      stats = s.stats;
      attempts = a.attempts;
      topics = t.topics;
    } catch (e) {
      root.innerHTML = errorBox(e.message);
      return;
    }
    root.innerHTML = dashboardHTML(stats, attempts, topics);
    bindExamButtons(root);
    $('dash-start').addEventListener('click', () => goView('import'));
    root.querySelectorAll('[data-go]').forEach((b) =>
      b.addEventListener('click', () => goView(b.dataset.go))
    );
    const mist = $('dash-mistakes');
    if (mist) mist.addEventListener('click', () => practiceMistakes(null, 'Repaso de errores'));
    root.querySelectorAll('[data-practice-domain]').forEach((b) =>
      b.addEventListener('click', () =>
        practiceMistakes(
          { section: b.dataset.practiceSection, domain: b.dataset.practiceDomain },
          'Repaso: ' + b.dataset.practiceDomain
        )
      )
    );
  }

  // Inicia una práctica con las preguntas falladas (opcionalmente de un subtema).
  async function practiceMistakes(params, label) {
    try {
      const { questions } = await window.API.mistakes(params || {});
      if (!questions.length) {
        alert(
          params && params.domain
            ? `¡No tienes errores en "${params.domain}" para repasar! 🎉`
            : '¡No tienes errores para repasar! 🎉 Haz un examen primero.'
        );
        return;
      }
      if (!(await window.__confirmStart('¿Comenzar el repaso de errores ahora?'))) return;
      window.__app.startPractice(questions, { mode: 'mistakes', title: label || 'Repaso de errores' });
    } catch (e) {
      alert('No se pudo iniciar el repaso: ' + e.message);
    }
  }

  function dashboardHTML(stats, attempts, topics) {
    const name = currentUser ? currentUser.displayName || currentUser.username : '';
    const recent = attempts.slice(0, 4);
    const deltaTxt =
      stats.lastDelta != null
        ? `<span class="text-sm font-medium ${stats.lastDelta >= 0 ? 'text-green-600' : 'text-error'}">${
            stats.lastDelta >= 0 ? '+' : ''
          }${stats.lastDelta} pts</span>`
        : '';

    return `
    <!-- Hero -->
    <section class="relative overflow-hidden rounded-xl bg-primary-container p-6 md:p-10 text-white shadow-lg mb-stack-lg">
      <div class="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div class="space-y-2 max-w-2xl">
          <h1 class="text-3xl md:text-5xl font-bold tracking-tight">¡Hola, ${esc(name)}!</h1>
          <p class="text-base md:text-lg opacity-90">
            ${
              stats.testsCompleted
                ? `Llevas ${stats.testsCompleted} examen${stats.testsCompleted === 1 ? '' : 'es'} completado${
                    stats.testsCompleted === 1 ? '' : 's'
                  }. Sigue practicando para acercarte a tu meta de 1600.`
                : 'Aún no has hecho ningún examen. Importa un PDF del Question Bank y empieza a practicar.'
            }
          </p>
        </div>
        <button id="dash-start" class="flex-shrink-0 bg-white text-primary px-6 md:px-8 py-3 rounded-lg font-semibold shadow-md hover:bg-surface-container transition-all active:scale-95">
          Comenzar práctica
        </button>
      </div>
      <div class="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
    </section>

    <!-- Stat cards -->
    <section class="grid grid-cols-1 md:grid-cols-3 gap-gutter mb-stack-lg">
      ${statCard('analytics', 'primary-container', 'text-white', 'Puntaje promedio', (stats.avgScore ?? '—'), deltaTxt)}
      ${statCard('assignment_turned_in', 'surface-container', 'text-primary', 'Exámenes completados', stats.testsCompleted || 0, '')}
      ${statCard('target', 'secondary-container', 'text-secondary', 'Precisión total', stats.accuracy != null ? stats.accuracy + '%' : '—', '')}
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter items-start mb-stack-lg">
      <!-- Recent exams -->
      <section class="lg:col-span-2 space-y-stack-md">
        <div class="flex justify-between items-center px-1">
          <h2 class="text-xl md:text-2xl font-semibold">Exámenes recientes</h2>
          <button class="text-sm font-semibold text-primary hover:underline" data-go="exams">Ver todos</button>
        </div>
        <div class="space-y-stack-sm">
          ${
            recent.length
              ? recent.map(examRow).join('')
              : `<div class="${CARD} p-8 text-center text-on-surface-variant">
                   Todavía no hay exámenes. <button class="text-primary font-semibold hover:underline" data-go="import">Crea el primero →</button>
                 </div>`
          }
        </div>
      </section>

      <!-- Next milestone / acciones -->
      <aside class="space-y-stack-md">
        <h2 class="text-xl md:text-2xl font-semibold px-1">Siguiente paso</h2>
        <div class="bg-white rounded-xl border-2 border-primary overflow-hidden shadow-md">
          <div class="bg-primary p-4 text-white flex items-center gap-2">
            <span class="material-symbols-outlined text-base">rocket_launch</span>
            <p class="text-xs uppercase tracking-widest opacity-80">Practica ahora</p>
          </div>
          <div class="p-6 space-y-stack-md">
            <div class="space-y-2">
              <h3 class="text-lg font-semibold text-on-surface">Nuevo examen de práctica</h3>
              <p class="text-sm text-on-surface-variant">Importa material del Question Bank o genera un examen aleatorio de tu banco.</p>
            </div>
            <button class="w-full bg-primary text-white py-3 rounded-lg font-semibold shadow hover:bg-primary-container transition-all active:scale-[0.98]" data-go="import">
              Crear examen
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <button class="text-left bg-surface-container-low p-4 rounded-xl border border-outline-variant hover:bg-surface-container-high transition-colors" data-go="exams">
            <span class="material-symbols-outlined text-primary">history</span>
            <p class="mt-2 text-xs text-on-surface-variant">Historial</p>
            <p class="text-sm font-semibold text-on-surface">Mis exámenes</p>
          </button>
          <button class="text-left bg-surface-container-low p-4 rounded-xl border border-outline-variant hover:bg-surface-container-high transition-colors" data-go="import">
            <span class="material-symbols-outlined text-on-tertiary-container">upload_file</span>
            <p class="mt-2 text-xs text-on-surface-variant">Subir PDF</p>
            <p class="text-sm font-semibold text-on-surface">Importar</p>
          </button>
        </div>
        <button id="dash-mistakes" class="w-full border-2 border-primary text-primary py-2.5 rounded-lg font-semibold text-sm hover:bg-surface-container transition-all flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-base">replay</span> Repasar mis errores
        </button>
      </aside>
    </div>

    <!-- Progresión -->
    <section class="${CARD} p-5 md:p-8 space-y-stack-md">
      <div class="flex justify-between items-center">
        <h2 class="text-xl md:text-2xl font-semibold">Progresión de puntaje</h2>
        <span class="px-3 py-1 bg-surface-container rounded-full text-xs font-semibold text-primary">Últimos ${stats.progression.length || 0}</span>
      </div>
      ${progressionChart(stats.progression)}
      <div class="pt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        ${miniStat('EBRW máx.', stats.bestRw ?? '—')}
        ${miniStat('Math máx.', stats.bestMath ?? '—')}
        ${miniStat('Precisión', stats.accuracy != null ? stats.accuracy + '%' : '—')}
        ${miniStat('Último', stats.lastScore ?? '—')}
      </div>
    </section>

    <!-- Rendimiento por tema y subtema -->
    <section class="mt-stack-lg space-y-stack-md">
      <h2 class="text-xl md:text-2xl font-semibold px-1">Rendimiento por tema</h2>
      ${topicsSection(topics)}
    </section>`;
  }

  // Desglose por tema (RW / Math) y subtema (domain) con barras de precisión.
  function topicsSection(topics) {
    if (!topics || !topics.length) {
      return `<div class="${CARD} p-8 text-center text-on-surface-variant">
        Haz un examen para ver tu precisión por tema y subtema.
      </div>`;
    }
    return `<div class="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
      ${topics.map(topicCard).join('')}
    </div>`;
  }

  function accColor(pct) {
    if (pct >= 80) return '#0a7d33';
    if (pct >= 55) return '#c99a06';
    return '#c0392b';
  }

  function topicCard(sec) {
    const domains = sec.domains
      .slice()
      .sort((a, b) => a.accuracy - b.accuracy) // primero lo más flojo
      .map((d) => {
        const col = accColor(d.accuracy);
        return `
          <button class="w-full text-left space-y-1 group" data-practice-section="${sec.key}" data-practice-domain="${esc(d.domain)}" title="Practicar tus errores de este subtema">
            <div class="flex justify-between items-baseline text-sm">
              <span class="text-on-surface group-hover:text-primary">${esc(d.domain)} <span class="material-symbols-outlined align-middle text-on-surface-variant" style="font-size:15px">replay</span></span>
              <span class="text-on-surface-variant">${d.correct}/${d.total} · <b style="color:${col}">${d.accuracy}%</b></span>
            </div>
            <div class="h-2 rounded-full bg-surface-container overflow-hidden">
              <span class="block h-full rounded-full" style="width:${d.accuracy}%;background:${col}"></span>
            </div>
          </button>`;
      })
      .join('');
    return `
      <div class="${CARD} p-5 md:p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold text-primary">${esc(sec.name)}</h3>
          <span class="text-sm text-on-surface-variant">Precisión <b class="text-primary">${sec.accuracy != null ? sec.accuracy + '%' : '—'}</b> · ${sec.correct}/${sec.total}</span>
        </div>
        <div class="space-y-3">${domains}</div>
      </div>`;
  }

  function statCard(icon, bg, iconColor, label, value, extra) {
    return `
      <div class="${CARD} p-6 flex items-center gap-4">
        <div class="w-12 h-12 rounded-full bg-${bg} flex items-center justify-center ${iconColor}">
          <span class="material-symbols-outlined">${icon}</span>
        </div>
        <div>
          <p class="text-xs text-on-surface-variant uppercase tracking-wider">${label}</p>
          <p class="text-2xl font-semibold text-primary">${value} ${extra}</p>
        </div>
      </div>`;
  }
  function miniStat(label, value) {
    return `
      <div class="p-4 rounded-lg bg-surface-container-low border border-outline-variant">
        <p class="text-xs text-on-surface-variant">${label}</p>
        <p class="text-xl font-semibold text-primary">${value}</p>
      </div>`;
  }

  function examRow(a) {
    return `
      <div class="${CARD} p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition-shadow">
        <div class="flex items-center gap-4 min-w-0">
          <div class="p-3 bg-surface-container-low rounded-lg shrink-0">
            <span class="material-symbols-outlined text-primary">description</span>
          </div>
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-on-surface truncate">${esc(a.title)}</h3>
            <p class="text-xs text-on-surface-variant">${fmtDate(a.createdAt)} · ${MODE_LABEL[a.mode] || a.mode || ''} · ${a.correctCount}/${a.totalQuestions} correctas</p>
          </div>
        </div>
        <div class="flex items-center gap-4 md:gap-6 shrink-0">
          <div class="text-center">
            <p class="text-xs text-on-surface-variant">Puntaje</p>
            <p class="text-base">${scorePill(a.totalScore)}</p>
          </div>
          <button class="bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-container transition-all active:scale-95" data-review="${a.id}">Revisar</button>
        </div>
      </div>`;
  }

  // Gráfico SVG de progresión (400–1600 → alto del svg).
  function progressionChart(points) {
    if (!points || points.length < 2) {
      return `<div class="h-40 flex items-center justify-center text-on-surface-variant text-sm border border-dashed border-outline-variant rounded-lg">
        Necesitas al menos 2 exámenes con puntaje para ver tu progresión.
      </div>`;
    }
    const W = 800,
      H = 200,
      pad = 10;
    const min = 400,
      max = 1600;
    const n = points.length;
    const x = (i) => pad + (i * (W - 2 * pad)) / (n - 1);
    const y = (v) => {
      const t = (Math.min(max, Math.max(min, v)) - min) / (max - min);
      return H - pad - t * (H - 2 * pad);
    };
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.totalScore).toFixed(1)}`).join(' ');
    const dots = points
      .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.totalScore).toFixed(1)}" r="4" fill="#1a365d"></circle>`)
      .join('');
    const labels = points
      .map((p, i) => {
        const lx = (x(i) / W) * 100;
        return `<span style="position:absolute;left:${lx.toFixed(2)}%;transform:translateX(-50%);">${esc(
          new Date(p.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'short' })
        )}</span>`;
      })
      .join('');
    return `
      <div class="relative">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="w-full h-48 border-b border-l border-outline-variant">
          <path d="${line}" fill="none" stroke="#1a365d" stroke-width="3" vector-effect="non-scaling-stroke"></path>
          ${dots}
        </svg>
        <div class="relative h-5 mt-1 text-xs text-on-surface-variant">${labels}</div>
      </div>`;
  }

  /* ---------------- MIS EXÁMENES ---------------- */
  async function loadExams() {
    const root = $('exams-root');
    root.innerHTML = loadingBox();
    let attempts;
    try {
      attempts = (await window.API.listAttempts()).attempts;
    } catch (e) {
      root.innerHTML = errorBox(e.message);
      return;
    }
    if (!attempts.length) {
      root.innerHTML = `<div class="${CARD} p-10 text-center">
        <p class="text-on-surface-variant mb-4">Todavía no tienes exámenes guardados.</p>
        <button class="bg-primary text-white px-6 py-3 rounded-lg font-semibold" data-go="import">Crear mi primer examen</button>
      </div>`;
      root.querySelector('[data-go]').addEventListener('click', () => goView('import'));
      return;
    }
    root.innerHTML = `<div class="space-y-stack-sm">${attempts.map(examFullRow).join('')}</div>`;
    bindExamButtons(root);
  }

  function examFullRow(a) {
    return `
      <div class="${CARD} p-4 md:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div class="flex items-center gap-4 min-w-0">
          <div class="p-3 bg-surface-container-low rounded-lg shrink-0">
            <span class="material-symbols-outlined text-primary">description</span>
          </div>
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-on-surface truncate">${esc(a.title)}</h3>
            <p class="text-xs text-on-surface-variant">
              ${fmtDate(a.createdAt)} · ${MODE_LABEL[a.mode] || a.mode || ''} ·
              ${a.correctCount}/${a.totalQuestions} correctas ·
              ⏱ ${fmtDuration(a.durationSeconds)}
              ${a.proctorAlerts ? ` · 📷 ${a.proctorAlerts} alerta${a.proctorAlerts === 1 ? '' : 's'}` : ''}
            </p>
            <div class="flex gap-3 mt-1 text-xs text-on-surface-variant">
              ${a.rwScore != null ? `<span>EBRW <b class="text-primary">${a.rwScore}</b></span>` : ''}
              ${a.mathScore != null ? `<span>Math <b class="text-primary">${a.mathScore}</b></span>` : ''}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-4 md:gap-6 shrink-0 flex-wrap">
          <div class="text-center px-2">
            <p class="text-xs text-on-surface-variant">Puntaje</p>
            <p class="text-lg">${scorePill(a.totalScore)}</p>
          </div>
          <button class="bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-container transition-all active:scale-95" data-review="${a.id}">Revisar</button>
          <button class="border border-primary text-primary px-4 py-2 rounded-lg text-sm font-semibold hover:bg-surface-container transition-all active:scale-95" data-redo="${a.id}">Rehacer</button>
          <button class="text-error/80 hover:text-error p-2" title="Eliminar" data-del="${a.id}">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </div>`;
  }

  function bindExamButtons(root) {
    root.querySelectorAll('[data-review]').forEach((b) =>
      b.addEventListener('click', () => openReview(parseInt(b.dataset.review, 10)))
    );
    root.querySelectorAll('[data-redo]').forEach((b) =>
      b.addEventListener('click', () => openRedo(parseInt(b.dataset.redo, 10)))
    );
    root.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => deleteAttempt(parseInt(b.dataset.del, 10), b))
    );
    root.querySelectorAll('[data-go]').forEach((b) =>
      b.addEventListener('click', () => goView(b.dataset.go))
    );
  }

  async function openReview(id) {
    try {
      const { attempt } = await window.API.getAttempt(id);
      window.__app.reviewAttempt(attempt);
    } catch (e) {
      alert('No se pudo abrir el examen: ' + e.message);
    }
  }
  async function openRedo(id) {
    if (!(await window.__confirmStart('¿Rehacer este examen ahora?'))) return;
    try {
      const { attempt } = await window.API.getAttempt(id);
      window.__app.redoAttempt(attempt);
    } catch (e) {
      alert('No se pudo rehacer el examen: ' + e.message);
    }
  }
  async function deleteAttempt(id, btn) {
    const ok = await window.__confirm({
      title: 'Eliminar examen',
      message: '¿Eliminar este examen del historial?',
      detail: 'Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.API.deleteAttempt(id);
      loadExams();
    } catch (e) {
      alert('No se pudo eliminar: ' + e.message);
    }
  }

  /* ---------------- ADMIN ---------------- */
  async function loadAdmin() {
    const root = $('admin-root');
    root.innerHTML = loadingBox();
    let users;
    try {
      users = (await window.API.adminListUsers()).users;
    } catch (e) {
      root.innerHTML = errorBox(e.message);
      return;
    }
    root.innerHTML = adminHTML(users);
    bindAdmin(root);
  }

  // Detalle de un alumno (modal) para el profesor.
  async function openStudentDetail(id) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'portal-modal-overlay';
    overlay.id = 'profile-modal';
    overlay.innerHTML = `
      <div class="portal-modal portal-modal-wide">
        <div class="portal-modal-head">
          <h2>Detalle del alumno</h2>
          <button class="portal-modal-close" aria-label="Cerrar">&times;</button>
        </div>
        <div class="portal-modal-body" id="sd-body">${loadingBox()}</div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.portal-modal-close')) closeModal();
    });
    try {
      const data = await window.API.adminStudent(id);
      $('sd-body').innerHTML = studentDetailHTML(data);
    } catch (e) {
      $('sd-body').innerHTML = errorBox(e.message);
    }
  }

  function studentDetailHTML(d) {
    const s = d.stats;
    const chip = (label, val) =>
      `<div class="p-3 rounded-lg bg-surface-container-low border border-outline-variant text-center">
         <p class="text-xs text-on-surface-variant">${label}</p>
         <p class="text-lg font-semibold text-primary">${val}</p>
       </div>`;
    const topicsRO =
      (d.topics || [])
        .map(
          (sec) => `
        <div class="mb-3">
          <div class="flex justify-between text-sm mb-1">
            <b class="text-primary">${esc(sec.name)}</b>
            <span class="text-on-surface-variant">${sec.accuracy != null ? sec.accuracy + '%' : '—'} · ${sec.correct}/${sec.total}</span>
          </div>
          ${sec.domains
            .slice()
            .sort((a, b) => a.accuracy - b.accuracy)
            .map((dm) => {
              const col = accColor(dm.accuracy);
              return `<div class="flex justify-between text-xs py-0.5"><span class="text-on-surface">${esc(dm.domain)}</span><span class="text-on-surface-variant"><b style="color:${col}">${dm.accuracy}%</b> (${dm.correct}/${dm.total})</span></div>`;
            })
            .join('')}
        </div>`
        )
        .join('') || '<p class="text-sm text-on-surface-variant">Sin datos de temas todavía.</p>';
    const rows =
      (d.attempts || [])
        .slice(0, 10)
        .map(
          (a) => `
        <div class="flex justify-between items-center py-2 border-b border-outline-variant text-sm">
          <div class="min-w-0">
            <div class="font-medium text-on-surface truncate">${esc(a.title)}</div>
            <div class="text-xs text-on-surface-variant">${fmtDate(a.createdAt)} · ${a.correctCount}/${a.totalQuestions}${a.proctorAlerts ? ' · 📷 ' + a.proctorAlerts : ''}</div>
          </div>
          <div class="font-semibold text-primary shrink-0 pl-3">${a.totalScore != null ? a.totalScore : '—'}</div>
        </div>`
        )
        .join('') || '<p class="text-sm text-on-surface-variant">Sin exámenes.</p>';
    return `
      <div class="mb-3">
        <h3 class="text-lg font-bold text-on-surface">${esc(d.student.displayName)}</h3>
        <p class="text-xs text-on-surface-variant">@${esc(d.student.username)}${d.student.active ? '' : ' · inactivo'}</p>
      </div>
      <div class="grid grid-cols-3 gap-2 mb-4">
        ${chip('Exámenes', s.testsCompleted)}
        ${chip('Promedio', s.avgScore != null ? s.avgScore : '—')}
        ${chip('Precisión', s.accuracy != null ? s.accuracy + '%' : '—')}
        ${chip('Mejor', s.bestScore != null ? s.bestScore : '—')}
        ${chip('Último', s.lastScore != null ? s.lastScore : '—')}
        ${chip('📷 Alertas', s.proctorAlerts)}
      </div>
      <div class="mb-4">${progressionChart(s.progression)}</div>
      <div class="mb-2 font-semibold text-primary text-sm">Rendimiento por tema</div>
      ${topicsRO}
      <div class="mt-4 mb-2 font-semibold text-primary text-sm">Últimos exámenes</div>
      ${rows}`;
  }

  function adminHTML(users) {
    const active = users.filter((u) => u.active).length;
    const withAvg = users.filter((u) => u.avgScore != null);
    const overallAvg = withAvg.length
      ? Math.round(withAvg.reduce((s, u) => s + u.avgScore, 0) / withAvg.length)
      : null;
    const totalExams = users.reduce((s, u) => s + u.attempts, 0);
    const summary = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-stack-md">
        ${miniStat('Alumnos', users.length)}
        ${miniStat('Activos', active)}
        ${miniStat('Exámenes totales', totalExams)}
        ${miniStat('Promedio general', overallAvg != null ? overallAvg : '—')}
      </div>`;
    return summary + `
    <div class="flex flex-col lg:flex-row gap-gutter items-start">
      <!-- Crear alumno (ancho fijo en escritorio para dar espacio a la tabla) -->
      <div class="${CARD} p-6 w-full lg:w-72 shrink-0">
        <h2 class="text-lg font-semibold text-primary mb-4">Nuevo alumno</h2>
        <form id="admin-create" class="space-y-3">
          <label class="block">
            <span class="text-xs font-semibold text-on-surface-variant">Nombre visible</span>
            <input type="text" id="ac-name" class="mt-1 w-full border border-outline-variant rounded-lg px-3 py-2 text-sm" placeholder="Ej. Juan Pérez" />
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-on-surface-variant">Usuario *</span>
            <input type="text" id="ac-user" class="mt-1 w-full border border-outline-variant rounded-lg px-3 py-2 text-sm" placeholder="juanp" autocomplete="off" />
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-on-surface-variant">Contraseña *</span>
            <div class="flex gap-2 mt-1">
              <input type="text" id="ac-pass" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-sm font-mono" placeholder="mín. 6 caracteres" autocomplete="off" />
              <button type="button" id="ac-gen" class="shrink-0 border border-outline-variant rounded-lg px-3 text-xs font-semibold text-primary hover:bg-surface-container">Generar</button>
            </div>
          </label>
          <div id="ac-error" class="text-error text-xs" hidden></div>
          <div id="ac-ok" class="text-green-700 text-xs" hidden></div>
          <button type="submit" class="w-full bg-primary text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-primary-container transition-all">Crear cuenta</button>
        </form>
      </div>

      <!-- Lista de alumnos -->
      <div class="${CARD} w-full lg:flex-1 min-w-0 overflow-hidden">
        <div class="px-5 py-4 border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
          <h2 class="text-lg font-semibold text-primary">Alumnos (${users.length})</h2>
        </div>
        <!-- Móvil: tarjetas -->
        <div class="md:hidden divide-y divide-outline-variant">
          ${
            users.length
              ? users.map(adminCard).join('')
              : '<div class="p-6 text-center text-on-surface-variant">Aún no hay alumnos. Crea el primero.</div>'
          }
        </div>
        <!-- Desktop: tabla -->
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <th class="px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant">Alumno</th>
                <th class="px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant">Exám.</th>
                <th class="px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant">Prom.</th>
                <th class="px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant">Mejor</th>
                <th class="px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant">Precisión</th>
                <th class="px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant">Estado</th>
                <th class="px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant text-right">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline-variant">
              ${
                users.length
                  ? users.map(adminRow).join('')
                  : `<tr><td colspan="7" class="px-4 py-8 text-center text-on-surface-variant">Aún no hay alumnos. Crea el primero.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  }

  function adminRow(u) {
    return `
      <tr class="hover:bg-surface-container transition-colors">
        <td class="px-4 py-3">
          <button class="text-left group" data-student="${u.id}" title="Ver detalle del alumno">
            <div class="font-semibold text-on-surface group-hover:text-primary group-hover:underline">${esc(u.displayName)}</div>
            <div class="text-xs text-on-surface-variant">@${esc(u.username)} · desde ${fmtDate(u.createdAt)}</div>
          </button>
        </td>
        <td class="px-4 py-3">${u.attempts}</td>
        <td class="px-4 py-3">${u.avgScore != null ? u.avgScore : '—'}</td>
        <td class="px-4 py-3">${u.bestScore != null ? `<b class="text-primary">${u.bestScore}</b>` : '—'}</td>
        <td class="px-4 py-3">${u.accuracy != null ? u.accuracy + '%' : '—'}</td>
        <td class="px-4 py-3">
          ${
            u.active
              ? '<span class="px-2 py-1 rounded-full text-xs font-bold bg-green-50 text-green-700 border border-green-200">Activo</span>'
              : '<span class="px-2 py-1 rounded-full text-xs font-bold bg-surface-variant text-on-surface-variant">Inactivo</span>'
          }
        </td>
        <td class="px-3 py-3 text-right whitespace-nowrap">
          <div class="inline-flex gap-1">${adminActionsIcons(u)}</div>
        </td>
      </tr>`;
  }

  // Acciones compactas (iconos) para la tabla de escritorio.
  function adminActionsIcons(u) {
    return `
      <button class="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container" title="Restablecer contraseña" data-reset="${u.id}"><span class="material-symbols-outlined text-lg">lock_reset</span></button>
      <button class="p-1.5 rounded ${u.active ? 'text-on-surface-variant hover:text-primary' : 'text-green-700'} hover:bg-surface-container" title="${u.active ? 'Desactivar' : 'Activar'}" data-toggle="${u.id}" data-active="${u.active ? 1 : 0}"><span class="material-symbols-outlined text-lg">${u.active ? 'block' : 'check_circle'}</span></button>
      <button class="p-1.5 rounded text-error hover:bg-surface-container" title="Eliminar alumno" data-deluser="${u.id}"><span class="material-symbols-outlined text-lg">delete</span></button>`;
  }

  function adminActionsHTML(u, pad) {
    pad = pad || '';
    return `
      <button class="text-xs font-semibold text-primary hover:underline ${pad}" data-reset="${u.id}">Reset clave</button>
      <button class="text-xs font-semibold ${u.active ? 'text-on-surface-variant' : 'text-green-700'} hover:underline ${pad}" data-toggle="${u.id}" data-active="${u.active ? 1 : 0}">${u.active ? 'Desactivar' : 'Activar'}</button>
      <button class="text-xs font-semibold text-error hover:underline ${pad}" data-deluser="${u.id}">Eliminar</button>`;
  }

  // Tarjeta de alumno para móvil (la tabla de escritorio se oculta en móvil).
  function adminCard(u) {
    const cell = (label, val) =>
      `<div><p class="text-xs text-on-surface-variant">${label}</p><p class="font-semibold text-on-surface">${val}</p></div>`;
    return `
      <div class="p-4">
        <div class="flex justify-between items-start gap-3">
          <button class="text-left min-w-0" data-student="${u.id}">
            <div class="font-semibold text-on-surface truncate">${esc(u.displayName)}</div>
            <div class="text-xs text-on-surface-variant truncate">@${esc(u.username)}</div>
          </button>
          ${
            u.active
              ? '<span class="px-2 py-1 rounded-full text-xs font-bold bg-green-50 text-green-700 border border-green-200 shrink-0">Activo</span>'
              : '<span class="px-2 py-1 rounded-full text-xs font-bold bg-surface-variant text-on-surface-variant shrink-0">Inactivo</span>'
          }
        </div>
        <div class="grid grid-cols-4 gap-2 mt-3 text-center">
          ${cell('Exám.', u.attempts)}
          ${cell('Prom.', u.avgScore != null ? u.avgScore : '—')}
          ${cell('Mejor', u.bestScore != null ? u.bestScore : '—')}
          ${cell('Precisión', u.accuracy != null ? u.accuracy + '%' : '—')}
        </div>
        <div class="flex flex-wrap gap-4 mt-3 pt-3 border-t border-outline-variant">
          ${adminActionsHTML(u)}
        </div>
      </div>`;
  }

  function genPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const arr = new Uint8Array(10);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(arr) : arr.forEach((_, i) => (arr[i] = (i * 7 + 3) % 256));
    let out = '';
    for (const b of arr) out += chars[b % chars.length];
    return out.slice(0, 4) + '-' + out.slice(4, 10);
  }

  function bindAdmin(root) {
    $('ac-gen').addEventListener('click', () => {
      $('ac-pass').value = genPassword();
    });

    root.querySelectorAll('[data-student]').forEach((b) =>
      b.addEventListener('click', () => openStudentDetail(parseInt(b.dataset.student, 10)))
    );

    $('admin-create').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('ac-error');
      const ok = $('ac-ok');
      err.hidden = true;
      ok.hidden = true;
      const username = $('ac-user').value.trim();
      const password = $('ac-pass').value;
      const displayName = $('ac-name').value.trim();
      try {
        await window.API.adminCreateUser({ username, password, displayName });
        // Recarga la lista PRIMERO (destruye el formulario) y luego muestra el
        // mensaje en el formulario nuevo, para que la contraseña no se pierda.
        await loadAdmin();
        const ok2 = $('ac-ok');
        if (ok2) {
          ok2.hidden = false;
          ok2.textContent = `✅ Cuenta "${username}" creada. Contraseña: ${password} — cópiala ahora, no se vuelve a mostrar.`;
        }
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
      }
    });

    root.querySelectorAll('[data-reset]').forEach((b) =>
      b.addEventListener('click', async () => {
        const np = genPassword();
        const ok = await window.__confirm({
          title: 'Restablecer contraseña',
          message: 'La contraseña del alumno pasará a ser:',
          detail: np + '  ·  cópiala ahora, no se vuelve a mostrar.',
          confirmText: 'Restablecer',
          cancelText: 'Cancelar',
          icon: '🔑',
        });
        if (!ok) return;
        try {
          await window.API.adminUpdateUser(parseInt(b.dataset.reset, 10), { password: np });
          alert(`Contraseña restablecida a: ${np}`);
        } catch (e) {
          alert('Error: ' + e.message);
        }
      })
    );
    root.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', async () => {
        const active = b.dataset.active === '1';
        try {
          await window.API.adminUpdateUser(parseInt(b.dataset.toggle, 10), { active: !active });
          loadAdmin();
        } catch (e) {
          alert('Error: ' + e.message);
        }
      })
    );
    root.querySelectorAll('[data-deluser]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await window.__confirm({
          title: 'Eliminar alumno',
          message: '¿Eliminar este alumno y TODOS sus exámenes?',
          detail: 'Esta acción no se puede deshacer.',
          confirmText: 'Eliminar',
          cancelText: 'Cancelar',
          danger: true,
        });
        if (!ok) return;
        try {
          await window.API.adminDeleteUser(parseInt(b.dataset.deluser, 10));
          loadAdmin();
        } catch (e) {
          alert('Error: ' + e.message);
        }
      })
    );
  }

  /* ---------------- Puente con el motor del examen ---------------- */
  window.__portal = {
    goView,
    saveCurrentAttempt: (payload) => window.API.saveAttempt(payload),
    openReview,
    openRedo,
  };

  /* ---------------- Arranque ---------------- */
  (async function init() {
    try {
      const r = await window.API.me();
      const user = r.user;
      localMode = !!r.localMode;
      if (user) enterApp(user);
      else showLogin();
    } catch (_) {
      showLogin();
    }
  })();
})();
