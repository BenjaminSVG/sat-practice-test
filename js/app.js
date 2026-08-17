/* ==========================================================================
   app.js — Lógica del examen de práctica SAT (interfaz estilo Bluebook)
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------- Estado global ---------------- */
  const state = {
    questions: [],       // preguntas parseadas (TODOS los módulos, concatenados)
    answers: {},         // index -> letra o texto
    marked: {},          // index -> bool
    crossed: {},         // index -> { A:true, ... }
    revealed: {},        // index -> bool (respuesta ya mostrada)
    current: 0,
    section: 'rw',       // 'rw' | 'math'
    timer: 0,            // segundos restantes del módulo actual (0 = sin cronómetro)
    tick: null,
    pendingFile: null,
    modules: [],          // [{ section, label, startIdx, endIdx, timerSeconds }]
    moduleIndex: 0,
    cameraMonitorEnabled: false,
    showAnswers: false,   // mostrar respuestas correctas durante el examen (modo estudio)
    proctorAlerts: [],    // { type, message, time } detectados durante el examen
    mode: 'quick',        // origen del examen: quick|demo|realistic|random|redo
    title: 'Examen de práctica',
    startedAt: 0,         // timestamp de inicio (para calcular duración)
    reviewing: false,     // true cuando se revisa un intento guardado (solo lectura)
  };

  const $ = (id) => document.getElementById(id);
  const screens = {
    login: $('screen-login'),
    portal: $('screen-portal'),
    test: $('screen-test'),
    review: $('screen-review'),
    break: $('screen-break'),
    results: $('screen-results'),
  };

  function show(name) {
    Object.values(screens).forEach((s) => s && s.classList.remove('active'));
    if (screens[name]) screens[name].classList.add('active');
  }
  // El portal (dashboard/importar/exámenes/admin) gestiona su navegación en portal.js.
  window.__show = show;
  window.__toast = (m, ms) => toast(m, ms);
  // Permite a otros módulos (portal, herramientas) apagar la cámara al salir.
  window.__stopProctor = () => stopProctor();

  function toast(msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._t);
    t._t = setTimeout(() => (t.hidden = true), ms);
  }

  /* ======================================================================
     DIÁLOGO DE CONFIRMACIÓN (bonito y responsive) — reemplaza confirm()
     Devuelve una promesa que resuelve true (aceptar) o false (cancelar).
     opts: { title, message, detail, confirmText, cancelText, danger, icon }
     ====================================================================== */
  function confirmDialog(opts) {
    opts = typeof opts === 'string' ? { message: opts } : opts || {};
    return new Promise((resolve) => {
      // Cierra cualquier diálogo previo para no apilar.
      document.querySelectorAll('.confirm-overlay').forEach((el) => el.remove());

      const overlay = document.createElement('div');
      overlay.className = 'portal-modal-overlay confirm-overlay';
      const danger = !!opts.danger;
      const icon = opts.icon || (danger ? '⚠️' : '❓');
      const lines = String(opts.message || '¿Confirmar esta acción?')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => `<p>${escapeHTML(l)}</p>`)
        .join('');
      const detail = opts.detail
        ? `<div class="confirm-detail">${escapeHTML(opts.detail)}</div>`
        : '';
      overlay.innerHTML = `
        <div class="confirm-modal ${danger ? 'danger' : ''}" role="alertdialog" aria-modal="true" aria-label="${escapeHTML(opts.title || 'Confirmación')}">
          <div class="confirm-icon" aria-hidden="true">${icon}</div>
          ${opts.title ? `<h2 class="confirm-title">${escapeHTML(opts.title)}</h2>` : ''}
          <div class="confirm-msg">${lines}</div>
          ${detail}
          <div class="confirm-actions">
            <button type="button" class="confirm-btn confirm-cancel">${escapeHTML(opts.cancelText || 'Cancelar')}</button>
            <button type="button" class="confirm-btn confirm-ok ${danger ? 'danger' : ''}">${escapeHTML(opts.confirmText || 'Aceptar')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      let done = false;
      const close = (val) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey);
        overlay.classList.add('closing');
        setTimeout(() => overlay.remove(), 150);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); close(true); }
      };
      overlay.querySelector('.confirm-ok').addEventListener('click', () => close(true));
      overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', onKey);
      // Enfoca el botón principal para accesibilidad.
      requestAnimationFrame(() => {
        const b = overlay.querySelector('.confirm-ok');
        if (b) b.focus();
      });
    });
  }
  window.__confirm = confirmDialog;

  // Confirmación estándar para iniciar un examen/práctica.
  function confirmStart(message) {
    return confirmDialog({
      title: 'Comenzar examen',
      message: message || '¿Comenzar el examen ahora?',
      detail: 'El cronómetro empezará al confirmar.',
      confirmText: 'Comenzar',
      cancelText: 'Cancelar',
      icon: '📝',
    });
  }
  window.__confirmStart = confirmStart;

  function escapeHTML(s) {
    return (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // Convierte texto plano con posibles \n y "______" en HTML seguro
  function richText(s) {
    if (!s) return '';
    const parts = escapeHTML(s).split(/\n{1,}/).filter(Boolean);
    return parts
      .map((p) => p.replace(/_{3,}/g, '<span class="blank">______</span>'))
      .map((p) => `<p>${p}</p>`)
      .join('');
  }

  /* ======================================================================
     MONITOREO POR CÁMARA (detección de movimientos sospechosos)
     ====================================================================== */
  function setProctorStatus(kind, text) {
    const widget = $('proctor-widget');
    const label = $('proctor-status');
    if (label) label.textContent = text;
    if (widget) widget.className = 'proctor-widget ' + kind;
  }

  function handleProctorAlert(alert) {
    state.proctorAlerts.push(alert);
    toast('⚠️ ' + alert.message);
    const widget = $('proctor-widget');
    if (!widget) return;
    widget.classList.add('flash');
    clearTimeout(widget._flashT);
    widget._flashT = setTimeout(() => widget.classList.remove('flash'), 1200);
  }

  function startProctor() {
    const widget = $('proctor-widget');
    const videoEl = $('proctor-video');
    if (!widget || !videoEl || !window.SATProctor) return;
    widget.hidden = false;
    setProctorStatus('loading', 'Iniciando monitoreo…');
    window.SATProctor
      .start({ videoEl, onStatus: setProctorStatus, onAlert: handleProctorAlert })
      .catch((err) => {
        console.error(err);
        toast('No se pudo activar el monitoreo por cámara.');
        widget.hidden = true;
        state.cameraMonitorEnabled = false;
      });
  }

  function stopProctor() {
    if (window.SATProctor) window.SATProctor.stop();
    const widget = $('proctor-widget');
    if (widget) widget.hidden = true;
  }

  /* ======================================================================
     IMPORTACIÓN DE PDF
     ====================================================================== */
  const dropzone = $('dropzone');
  const fileInput = $('file-input');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  function setStatus(msg, kind) {
    const el = $('import-status');
    el.hidden = false;
    el.className = 'import-status ' + kind;
    el.innerHTML = msg;
  }

  /* ======================================================================
     BANCO LOCAL DE PREGUNTAS
     Se acumula, dentro de esta sesión del navegador, con cada PDF que el
     usuario importa (en cualquiera de los dos modos). Sirve de base para
     generar el "Examen Aleatorio". No se descarga nada de collegeboard.org
     de forma automática: solo se reutiliza lo que el propio usuario exportó
     desde el Question Bank.
     ====================================================================== */
  const bank = { rw: [], math: [] };
  const bankIds = new Set();

  function addToBank(questions) {
    let added = 0;
    questions.forEach((q) => {
      const key = q.section + '|' + q.id;
      if (bankIds.has(key)) return;
      bankIds.add(key);
      bank[q.section === 'math' ? 'math' : 'rw'].push(q);
      added++;
    });
    if (added) updateBankBadge();
    return added;
  }

  function updateBankBadge() {
    const el = $('bank-badge');
    if (!el) return;
    const total = bank.rw.length + bank.math.length;
    el.textContent = total
      ? `Banco: ${bank.rw.length} preguntas de Reading & Writing · ${bank.math.length} de Math (PDF importados + exámenes anteriores)`
      : 'Banco vacío — importa un PDF o completa un examen para poder generar uno aleatorio.';

    const rwInput = $('opt-random-rw');
    const mathInput = $('opt-random-math');
    if (rwInput) {
      rwInput.max = bank.rw.length;
      if (!rwInput.dataset.touched) rwInput.value = Math.min(GUIDE.rw.perModule, bank.rw.length);
    }
    if (mathInput) {
      mathInput.max = bank.math.length;
      if (!mathInput.dataset.touched) mathInput.value = Math.min(GUIDE.math.perModule, bank.math.length);
    }
    const genBtn = $('btn-random-generate');
    if (genBtn) genBtn.disabled = total === 0;
  }

  async function handleFile(file) {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setStatus('Por favor selecciona un archivo PDF válido.', 'error');
      return;
    }
    setStatus('⏳ Leyendo <strong>' + escapeHTML(file.name) + '</strong>…', 'working');
    $('btn-start').disabled = true;
    try {
      const buf = await file.arrayBuffer();
      const questions = await window.SATParser.parsePDF(buf, file.name);
      addToBank(questions);
      if (!questions.length) {
        setStatus(
          'No se detectaron preguntas en este PDF. Asegúrate de que sea una exportación del ' +
            'Question Bank del College Board. También puedes usar la demostración.',
          'error'
        );
        return;
      }
      state.pendingFile = questions;
      const nRW = questions.filter((q) => q.section === 'rw').length;
      const nMath = questions.filter((q) => q.section === 'math').length;
      setStatus(
        `✅ Se detectaron <strong>${questions.length}</strong> preguntas ` +
          `(${nRW} de Reading &amp; Writing, ${nMath} de Math). Ajusta las opciones y comienza.`,
        'success'
      );
      $('import-options').hidden = false;
      // Preselecciona el tiempo según la sección predominante
      $('opt-timer').value = nMath > nRW ? '2100' : '1920';
      $('btn-start').disabled = false;
    } catch (err) {
      console.error(err);
      setStatus('Ocurrió un error al leer el PDF: ' + escapeHTML(err.message), 'error');
    }
  }

  // Opciones de importación
  $('opt-timer').addEventListener('change', (e) => {
    $('opt-custom-row').hidden = e.target.value !== 'custom';
  });

  $('btn-start').addEventListener('click', async () => {
    if (!state.pendingFile) return;
    let qs = state.pendingFile;
    const sec = $('opt-section').value;
    if (sec !== 'auto') qs = qs.filter((q) => q.section === sec);
    if (!qs.length) {
      toast('No hay preguntas de esa sección en el PDF.');
      return;
    }
    if (!(await confirmStart('¿Comenzar el examen ahora?'))) return;
    startTest(qs, computeTimer(), { mode: 'quick' });
  });

  $('btn-demo').addEventListener('click', async () => {
    if (!(await confirmStart('¿Comenzar la demostración ahora?'))) return;
    startTest(DEMO_QUESTIONS.map((q) => ({ ...q })), 1920, { mode: 'demo' });
  });

  function computeTimer() {
    const v = $('opt-timer').value;
    if (v === 'custom') return Math.max(1, parseInt($('opt-custom-min').value || '30', 10)) * 60;
    return parseInt(v, 10) || 0;
  }

  /* ======================================================================
     TEST DE PRÁCTICA REALISTA
     ====================================================================== */
  // Guía de composición del SAT digital completo (referencia oficial aproximada).
  const GUIDE = {
    rw: {
      name: 'Reading and Writing',
      totalText: '54 preguntas (2 módulos de 27) · 64 min',
      perModule: 27,
      domains: [
        ['Craft and Structure', '13–15'],
        ['Information and Ideas', '12–13'],
        ['Standard English Conventions', '11–15'],
        ['Expression of Ideas', '8–12'],
      ],
      diff: { easy: 25, med: 50, hard: 25 },
      secPerQ: 71, // ~ tiempo por pregunta (32 min / 27)
    },
    math: {
      name: 'Math',
      totalText: '44 preguntas (2 módulos de 22) · 70 min',
      perModule: 22,
      domains: [
        ['Algebra', '13–15'],
        ['Advanced Math', '13–15'],
        ['Problem-Solving and Data Analysis', '5–7'],
        ['Geometry and Trigonometry', '5–7'],
      ],
      types: [['Opción múltiple', '~75%'], ['Respuesta libre (grid-in)', '~25%']],
      diff: { easy: 25, med: 50, hard: 25 },
      secPerQ: 95, // ~ tiempo por pregunta (35 min / 22)
    },
  };

  function renderGuide() {
    const card = (g) => `
      <div class="guide-card">
        <h4>${g.name}</h4>
        <p class="gc-sub">${g.totalText}</p>
        <ul>
          ${g.domains.map((d) => `<li>${d[0]}: <b>${d[1]}</b></li>`).join('')}
          ${g.types ? g.types.map((t) => `<li>${t[0]}: <b>${t[1]}</b></li>`).join('') : ''}
        </ul>
        <div class="gc-diff">
          <span class="gc-pill easy">Fáciles ~${g.diff.easy}%</span>
          <span class="gc-pill med">Medias ~${g.diff.med}%</span>
          <span class="gc-pill hard">Difíciles ~${g.diff.hard}%</span>
        </div>
      </div>`;
    $('guide-grid').innerHTML = card(GUIDE.rw) + card(GUIDE.math);
  }
  renderGuide();

  // Cambio de pestañas de modo
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.mode-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('mode-' + tab.dataset.mode).classList.add('active');
    });
  });

  // Estado de importación realista
  const real = { rw: null, math: null };

  function bindRealSlot(sec, dzId, inputId) {
    const dz = $(dzId);
    const input = $(inputId);
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
      if (e.dataTransfer.files[0]) loadRealFile(sec, e.dataTransfer.files[0]);
    });
    input.addEventListener('change', (e) => {
      if (e.target.files[0]) loadRealFile(sec, e.target.files[0]);
    });
  }
  bindRealSlot('rw', 'dz-rw', 'file-rw');
  bindRealSlot('math', 'dz-math', 'file-math');

  async function loadRealFile(sec, file) {
    const report = $('report-' + sec);
    report.hidden = false;
    report.innerHTML = '⏳ Leyendo <strong>' + escapeHTML(file.name) + '</strong>…';
    try {
      const buf = await file.arrayBuffer();
      let questions = await window.SATParser.parsePDF(buf, file.name);
      // Conserva solo las de la sección correspondiente
      questions = questions.filter((q) => (sec === 'math' ? q.section === 'math' : q.section === 'rw'));
      addToBank(questions);
      if (!questions.length) {
        report.innerHTML =
          `<span class="warn">No se encontraron preguntas de ${GUIDE[sec].name} en este PDF.</span>`;
        real[sec] = null;
      } else {
        real[sec] = questions;
        report.innerHTML = analyzeSet(questions, sec);
      }
    } catch (err) {
      report.innerHTML = '<span class="warn">Error al leer el PDF: ' + escapeHTML(err.message) + '</span>';
      real[sec] = null;
    }
    $('btn-start-real').disabled = !(real.rw || real.math);
  }

  // Analiza un conjunto contra la guía y devuelve HTML del reporte
  function analyzeSet(questions, sec) {
    const g = GUIDE[sec];
    const total = questions.length;
    const diff = { Easy: 0, Medium: 0, Hard: 0, '': 0 };
    const domains = {};
    let mcq = 0, spr = 0;
    questions.forEach((q) => {
      diff[q.difficulty || ''] = (diff[q.difficulty || ''] || 0) + 1;
      domains[q.domain || 'Otro'] = (domains[q.domain || 'Otro'] || 0) + 1;
      if (q.type === 'spr') spr++; else mcq++;
    });

    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    const within = (p, target) => Math.abs(p - target) <= 12; // tolerancia ±12 pts
    const flag = (p, target) =>
      `<span class="${within(p, target) ? 'ok' : 'warn'}">${p}%</span>`;

    const domRows = g.domains
      .map((d) => {
        const c = domains[d[0]] || 0;
        return `<div class="sr-row"><span>${d[0]}</span><span>${c} <span style="color:var(--bb-muted)">(rec. ${d[1]})</span></span></div>`;
      })
      .join('');

    const typeRows =
      sec === 'math'
        ? `<div class="sr-row"><span>Opción múltiple</span><span>${mcq} · ${pct(mcq)}% ${
            within(pct(mcq), 75) ? '<span class="ok">✓</span>' : '<span class="warn">≠ ~75%</span>'
          }</span></div>
           <div class="sr-row"><span>Respuesta libre (grid-in)</span><span>${spr} · ${pct(spr)}% ${
            within(pct(spr), 25) ? '<span class="ok">✓</span>' : '<span class="warn">≠ ~25%</span>'
          }</span></div>`
        : '';

    const totalNote =
      total >= g.perModule
        ? `<span class="ok">✓ suficientes para un módulo (${g.perModule})</span>`
        : `<span class="warn">faltan ${g.perModule - total} para un módulo completo (${g.perModule})</span>`;

    return `
      <div class="sr-total">${total} preguntas — ${totalNote}</div>
      <div class="sr-row"><span>Fáciles</span><span>${diff.Easy} · ${flag(pct(diff.Easy), g.diff.easy)} <span style="color:var(--bb-muted)">(rec. ~${g.diff.easy}%)</span></span></div>
      <div class="sr-row"><span>Medias</span><span>${diff.Medium} · ${flag(pct(diff.Medium), g.diff.med)} <span style="color:var(--bb-muted)">(rec. ~${g.diff.med}%)</span></span></div>
      <div class="sr-row"><span>Difíciles</span><span>${diff.Hard} · ${flag(pct(diff.Hard), g.diff.hard)} <span style="color:var(--bb-muted)">(rec. ~${g.diff.hard}%)</span></span></div>
      ${typeRows}
      <div class="sr-note"><b>Dominios:</b></div>
      ${domRows}`;
  }

  $('btn-start-real').addEventListener('click', async () => {
    const rw = real.rw || [];
    const math = real.math || [];
    if (!rw.length && !math.length) return;
    if (!(await confirmStart('¿Comenzar el examen realista ahora?'))) return;
    const useRealistic = $('opt-real-timer').value === 'realistic';
    const rwTimer = useRealistic ? rw.length * GUIDE.rw.secPerQ : 0;
    const mathTimer = useRealistic ? math.length * GUIDE.math.secPerQ : 0;
    startModularTest([
      rw.length ? { section: 'rw', label: 'Reading and Writing', questions: rw, timerSeconds: rwTimer } : null,
      math.length ? { section: 'math', label: 'Math', questions: math, timerSeconds: mathTimer } : null,
    ].filter(Boolean), { mode: 'realistic' });
  });

  /* ======================================================================
     EXAMEN ALEATORIO — samplea del banco local acumulado
     ====================================================================== */
  function shuffleArr(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Selecciona `total` preguntas del banco de una sección, intentando respetar
  // la distribución de dificultad de la guía (25% fácil / 50% media / 25% difícil).
  function sampleModule(section, total) {
    const pool = shuffleArr(bank[section]);
    const n = Math.min(Math.max(0, total), pool.length);
    if (n <= 0) return [];

    const g = GUIDE[section].diff;
    const targetEasy = Math.round((n * g.easy) / 100);
    const targetHard = Math.round((n * g.hard) / 100);
    const targets = { Easy: targetEasy, Hard: targetHard, Medium: n - targetEasy - targetHard };

    const byDiff = { Easy: [], Medium: [], Hard: [] };
    pool.forEach((q) => { if (byDiff[q.difficulty]) byDiff[q.difficulty].push(q); });

    const picked = [];
    const pickedIds = new Set();
    ['Easy', 'Medium', 'Hard'].forEach((d) => {
      let have = 0;
      for (const q of byDiff[d]) {
        if (have >= targets[d]) break;
        picked.push(q);
        pickedIds.add(q.id);
        have++;
      }
    });
    // Completa el resto (si faltó stock en alguna dificultad) con lo que quede.
    if (picked.length < n) {
      for (const q of pool) {
        if (picked.length >= n) break;
        if (!pickedIds.has(q.id)) { picked.push(q); pickedIds.add(q.id); }
      }
    }
    return shuffleArr(picked).slice(0, n);
  }

  const randomState = { rw: [], math: [] };

  ['opt-random-rw', 'opt-random-math'].forEach((id) => {
    $(id).addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
  });

  $('btn-random-generate').addEventListener('click', () => {
    const nRW = parseInt($('opt-random-rw').value, 10) || 0;
    const nMath = parseInt($('opt-random-math').value, 10) || 0;
    if (nRW <= 0 && nMath <= 0) { toast('Elige al menos una pregunta.'); return; }

    const rwSample = sampleModule('rw', nRW);
    const mathSample = sampleModule('math', nMath);
    if (!rwSample.length && !mathSample.length) {
      toast('El banco no tiene preguntas de esa sección todavía. Importa un PDF o completa un examen primero.');
      return;
    }
    randomState.rw = rwSample;
    randomState.math = mathSample;

    const parts = [];
    if (nRW > 0) {
      parts.push(
        `<div class="sr-note"><b>Reading and Writing (${rwSample.length}/${nRW} solicitadas)</b></div>` +
          analyzeSet(rwSample, 'rw')
      );
    }
    if (nMath > 0) {
      parts.push(
        `<div class="sr-note" style="margin-top:14px"><b>Math (${mathSample.length}/${nMath} solicitadas)</b></div>` +
          analyzeSet(mathSample, 'math')
      );
    }
    $('random-report').hidden = false;
    $('random-report').innerHTML = parts.join('');
    $('random-start-wrap').hidden = false;
  });

  $('btn-random-start').addEventListener('click', async () => {
    const rw = randomState.rw || [];
    const math = randomState.math || [];
    if (!rw.length && !math.length) return;
    if (!(await confirmStart('¿Comenzar el examen aleatorio ahora?'))) return;
    const useRealistic = $('opt-random-timer').value === 'realistic';
    const rwTimer = useRealistic ? rw.length * GUIDE.rw.secPerQ : 0;
    const mathTimer = useRealistic ? math.length * GUIDE.math.secPerQ : 0;
    startModularTest([
      rw.length ? { section: 'rw', label: 'Reading and Writing', questions: rw, timerSeconds: rwTimer } : null,
      math.length ? { section: 'math', label: 'Math', questions: math, timerSeconds: mathTimer } : null,
    ].filter(Boolean), { mode: 'random' });
  });

  /* ======================================================================
     INICIO DEL TEST — normalización de preguntas y arranque de módulos
     ====================================================================== */
  function normalizeQuestions(questions) {
    return questions.map((q) => {
      const out = { ...q };
      if (q.section === 'rw' && !q.needsImage) {
        const { passage, question } = window.SATParser.splitStem(q.stem);
        out.passage = passage;
        out.prompt = question || q.stem;
      } else {
        out.passage = '';
        out.prompt = q.stem;
      }
      return out;
    });
  }

  // Práctica rápida / demo: un único módulo con todas las preguntas.
  function startTest(questions, timerSeconds, meta) {
    const isMath = questions.every((q) => q.section === 'math');
    startModularTest(
      [
        {
          section: isMath ? 'math' : 'rw',
          label: isMath ? 'Math' : 'Reading and Writing',
          questions,
          timerSeconds,
        },
      ],
      meta
    );
  }

  // Test de Práctica Realista: uno o dos módulos independientes, cada uno con
  // su propio cronómetro. Entre módulos se muestra una pantalla de descanso.
  function startModularTest(modDescs, meta) {
    meta = meta || {};
    state.reviewing = false;
    state.mode = meta.mode || 'quick';
    state.startedAt = Date.now();
    state.questions = [];
    state.modules = [];
    let offset = 0;
    modDescs.forEach((m) => {
      const norm = normalizeQuestions(m.questions);
      state.questions = state.questions.concat(norm);
      state.modules.push({
        section: m.section,
        label: m.label,
        startIdx: offset,
        endIdx: offset + norm.length,
        timerSeconds: m.timerSeconds || 0,
      });
      offset += norm.length;
    });
    state.answers = {};
    state.marked = {};
    state.crossed = {};
    state.revealed = {};
    state.proctorAlerts = [];

    const modeNames = {
      quick: 'Práctica rápida',
      demo: 'Demostración',
      realistic: 'Test realista',
      random: 'Examen aleatorio',
      redo: 'Repetición',
    };
    const labels = state.modules.map((m) => m.label).join(' + ');
    state.title = meta.title || `${modeNames[state.mode] || 'Examen'} — ${labels}`;

    const camCheckbox = $('opt-camera-monitor');
    state.cameraMonitorEnabled = meta.cameraMonitor != null
      ? !!meta.cameraMonitor
      : !!(camCheckbox && camCheckbox.checked);
    const ansCheckbox = $('opt-show-answers');
    state.showAnswers = meta.showAnswers != null
      ? !!meta.showAnswers
      : !!(ansCheckbox && ansCheckbox.checked);
    startModule(0);
    if (state.cameraMonitorEnabled) startProctor();
  }

  function currentModule() {
    return state.modules[state.moduleIndex] || { section: 'rw', label: '', startIdx: 0, endIdx: state.questions.length, timerSeconds: 0 };
  }

  function isLastModule() {
    return state.moduleIndex >= state.modules.length - 1;
  }

  function startModule(idx) {
    state.moduleIndex = idx;
    const m = state.modules[idx];
    state.current = m.startIdx;
    state.section = m.section;
    state.timer = m.timerSeconds;

    const isMath = m.section === 'math';
    $('btn-calc').hidden = !isMath;
    $('btn-ref').hidden = !isMath;

    const secNum = isMath ? 2 : 1;
    const label = `Section ${secNum}, Module 1: ${m.label}`;
    $('section-title').textContent = label;
    $('navpop-title').textContent = label;
    $('directions-text').textContent = isMath
      ? 'The questions in this section address a number of important math skills. Use of a calculator is permitted for all questions. A reference sheet, calculator, and these directions can be accessed throughout the test.'
      : 'The questions in this section address a number of important reading and writing skills. Each question includes one or more passages, which may include a table or graph. Read each passage and question carefully, and then choose the best answer.';

    show('test');
    startTimer();
    renderQuestion();
  }

  /* ======================================================================
     CRONÓMETRO
     ====================================================================== */
  function startTimer() {
    clearInterval(state.tick);
    const wrap = $('timer-wrap');
    if (!state.timer) {
      wrap.style.visibility = 'hidden';
      return;
    }
    wrap.style.visibility = 'visible';
    updateTimerDisplay();
    state.tick = setInterval(() => {
      state.timer--;
      updateTimerDisplay();
      if (state.timer <= 0) {
        clearInterval(state.tick);
        toast('⏰ Tiempo agotado');
        gotoReview();
      }
    }, 1000);
  }
  function updateTimerDisplay() {
    const el = $('timer');
    // Si el usuario lo ocultó, no lo sobrescribimos con la hora real en cada tick.
    if (el.classList.contains('hidden-time')) {
      el.textContent = '••:••';
      return;
    }
    const m = Math.floor(state.timer / 60);
    const s = state.timer % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }
  $('btn-timer-toggle').addEventListener('click', function () {
    const el = $('timer');
    const hidden = el.classList.toggle('hidden-time');
    this.textContent = hidden ? 'Show' : 'Hide';
    updateTimerDisplay();
  });

  /* ======================================================================
     RENDER DE LA PREGUNTA
     ====================================================================== */
  function renderQuestion() {
    const i = state.current;
    const q = state.questions[i];
    const body = $('bb-body');
    const revealed = !!state.revealed[i];
    const m = currentModule();

    // Encabezado (numeración relativa al módulo, como en el SAT real)
    $('q-number').textContent = i - m.startIdx + 1;

    // Marca de revisión
    const isMarked = !!state.marked[i];
    $('btn-mark').classList.toggle('marked', isMarked);
    $('mark-label').textContent = isMarked ? 'Marked for Review' : 'Mark for Review';

    body.classList.remove('crossout-mode');
    $('btn-crossout-toggle').classList.remove('active');

    // --- Referencias a los contenedores ---
    const passageEl = $('passage-content'); // panel izquierdo: texto (pasaje / enunciado)
    const passageImg = $('passage-image');  // panel izquierdo: imagen del enunciado (Math)
    const qText = $('question-content');
    const qImage = $('question-image');
    const choicesEl = $('choices');
    const lettersEl = $('letters');
    const sprWrap = $('spr-wrap');
    choicesEl.innerHTML = '';
    lettersEl.innerHTML = '';

    const isMath = q.section === 'math';
    // Figura de R&W con opciones de texto: se muestra la imagen del gráfico/tabla
    // (recortada ANTES de las opciones) y las opciones como texto clicable.
    const rwHybrid =
      q.needsImage && !isMath && !q.isSPR && q.choices.length > 0 && q.choices.some((c) => c.text);
    // Pasaje de Reading & Writing (solo texto, sin figura).
    const hasPassage = q.passage && q.passage.length > 2 && !q.needsImage;
    // Dos columnas: pasaje de R&W, o CUALQUIER pregunta de Math (enunciado a la
    // izquierda y opciones a la derecha, igual que Reading & Writing).
    const twoCol = hasPassage || isMath;
    body.classList.toggle('single', !twoCol);

    // ---- Panel izquierdo (pasaje / enunciado) ----
    if (hasPassage) {
      passageEl.hidden = false;
      passageEl.innerHTML = richText(q.passage);
      passageImg.hidden = true;
      passageImg.innerHTML = '';
    } else if (isMath && q.needsImage) {
      // Enunciado matemático con figura: imagen a la izquierda.
      passageEl.hidden = true;
      passageEl.innerHTML = '';
      passageImg.hidden = false;
      renderQuestionImage(q, passageImg);
    } else if (isMath) {
      // Enunciado matemático de solo texto: a la izquierda.
      passageEl.hidden = false;
      passageEl.innerHTML = richText(q.prompt);
      passageImg.hidden = true;
      passageImg.innerHTML = '';
    } else {
      passageEl.hidden = true;
      passageEl.innerHTML = '';
      passageImg.hidden = true;
      passageImg.innerHTML = '';
    }

    // ---- Panel derecho (pregunta y/o opciones) ----
    if (isMath) {
      // El enunciado ya está a la izquierda; a la derecha solo van las opciones.
      qText.hidden = true;
      qText.innerHTML = '';
      qImage.hidden = true;
      if (q.isSPR || q.choices.length === 0) {
        choicesEl.hidden = true;
        lettersEl.hidden = true;
        sprWrap.hidden = false;
        renderSprInput(i, revealed);
      } else if (q.needsImage) {
        // Las opciones están dentro de la figura: botones de letra para elegir.
        choicesEl.hidden = true;
        sprWrap.hidden = true;
        lettersEl.hidden = false;
        renderLetterButtons(q, i, revealed);
      } else {
        lettersEl.hidden = true;
        sprWrap.hidden = true;
        choicesEl.hidden = false;
        renderTextChoices(q, i, revealed);
      }
    } else if (q.needsImage && !rwHybrid) {
      // ---- R&W con figura en modo imagen completo ----
      qText.hidden = true;
      qImage.hidden = false;
      renderQuestionImage(q, qImage);

      choicesEl.hidden = true;
      if (q.isSPR) {
        lettersEl.hidden = true;
        sprWrap.hidden = false;
        renderSprInput(i, revealed);
      } else {
        sprWrap.hidden = true;
        lettersEl.hidden = false;
        renderLetterButtons(q, i, revealed);
      }
    } else if (rwHybrid) {
      // ---- Modo híbrido (R&W con figura): imagen del gráfico + opciones de texto ----
      qText.hidden = true;
      qImage.hidden = false;
      renderQuestionImage(q, qImage, true); // recorte hasta antes de las opciones
      lettersEl.hidden = true;
      sprWrap.hidden = true;
      choicesEl.hidden = false;
      renderTextChoices(q, i, revealed);
    } else {
      // ---- Modo texto (Reading & Writing) ----
      qImage.hidden = true;
      qText.hidden = false;
      qText.innerHTML = richText(q.prompt);
      lettersEl.hidden = true;

      if (q.isSPR || q.choices.length === 0) {
        choicesEl.hidden = true;
        sprWrap.hidden = false;
        renderSprInput(i, revealed);
      } else {
        choicesEl.hidden = false;
        sprWrap.hidden = true;
        renderTextChoices(q, i, revealed);
      }
    }

    // El botón "Check" de respuesta libre solo tiene sentido en modo estudio
    // (mostrar respuestas). Sin él, la respuesta se registra al escribir.
    const sprCheck = $('btn-spr-check');
    if (sprCheck) sprCheck.hidden = !state.showAnswers || revealed;

    renderFeedback(q, i);
    updateNavLabel();
    const t = $('timer');
    if (t.classList.contains('hidden-time')) t.textContent = '••:••';
  }

  // Pinta las opciones (A–D) como texto clicable con opción de tachar.
  function renderTextChoices(q, i, revealed) {
    const choicesEl = $('choices');
    q.choices.forEach((c) => {
      const selected = state.answers[i] === c.letter;
      const crossed = state.crossed[i] && state.crossed[i][c.letter];
      let extra = '';
      if (revealed) {
        if (c.letter === (q.correct || '').toUpperCase()) extra = ' correct';
        else if (selected) extra = ' incorrect';
      }
      const div = document.createElement('div');
      div.className = 'choice' + (selected ? ' selected' : '') + (crossed ? ' crossed' : '') + extra;
      div.innerHTML = `
        <button class="choice-main" data-letter="${c.letter}" ${revealed ? 'disabled' : ''}>
          <span class="choice-letter">${c.letter}</span>
          <span class="choice-body">${escapeHTML(c.text)}</span>
        </button>
        <button class="choice-cross" data-cross="${c.letter}" title="Tachar/Restaurar">
          <span class="letter">${c.letter}</span>
        </button>`;
      choicesEl.appendChild(div);
    });
  }

  // Botones de letra (A–D) para preguntas cuyas opciones están dentro de una imagen.
  function renderLetterButtons(q, i, revealed) {
    const lettersEl = $('letters');
    q.choices.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'letter-btn' + (state.answers[i] === c.letter ? ' selected' : '');
      btn.textContent = c.letter;
      btn.dataset.letter = c.letter;
      btn.disabled = revealed;
      if (revealed) {
        if (c.letter === (q.correct || '').toUpperCase()) btn.classList.add('correct');
        else if (state.answers[i] === c.letter) btn.classList.add('incorrect');
      }
      lettersEl.appendChild(btn);
    });
  }

  // Prepara el campo de respuesta libre (grid-in).
  function renderSprInput(i, revealed) {
    $('spr-input').value = state.answers[i] || '';
    $('spr-input').disabled = revealed;
    $('spr-preview').textContent = '';
  }

  // Renderiza (con caché) la imagen de la región del PDF de la pregunta.
  // useFigureBottom: recorta hasta ANTES de las opciones (figuras de R&W).
  function renderQuestionImage(q, container, useFigureBottom) {
    if (q._img) {
      container.innerHTML = `<img src="${q._img}" alt="Pregunta"/>` +
        `<p class="img-hint">Contenido tomado del PDF del College Board.</p>`;
      return;
    }
    if (q._imgFailed) {
      // No se pudo renderizar: mostramos el texto extraído como respaldo
      container.innerHTML =
        '<p class="img-hint">No se pudo renderizar la imagen; se muestra el texto extraído:</p>' +
        richText(q.prompt);
      return;
    }
    container.innerHTML = '<p class="img-hint">Cargando pregunta…</p>';
    const g = q.geom;
    if (!g) { q._imgFailed = true; renderQuestionImage(q, container); return; }
    if (q._rendering) return; // ya hay un render en curso para esta pregunta
    q._rendering = true;
    // Figuras de R&W: recorta hasta antes de las opciones (figureBottom).
    const bottom = useFigureBottom && g.figureBottom != null
      ? g.figureBottom
      : g.cropBottom != null
      ? g.cropBottom
      : g.correctY;
    window.SATParser.renderRegion(q.srcId, g.page, g.stemTopY, bottom)
      .then((url) => {
        q._rendering = false;
        q._img = url;
        if (stillValidContainer(container, q)) renderQuestionImage(q, container, useFigureBottom);
      })
      .catch(() => {
        q._rendering = false;
        q._imgFailed = true;
        if (stillValidContainer(container, q)) renderQuestionImage(q, container, useFigureBottom);
      });
  }

  // El contenedor del test (#question-image) se reutiliza entre preguntas, así que
  // solo se rellena si seguimos en esa pregunta. Los contenedores de la lista de
  // resultados son únicos: basta con que sigan en el DOM.
  function stillValidContainer(container, q) {
    // Los contenedores reutilizados de la pantalla de examen (imagen de pregunta o
    // de enunciado) solo son válidos si seguimos en esa misma pregunta.
    if (container && (container.id === 'question-image' || container.id === 'passage-image'))
      return state.questions[state.current] === q;
    return !!(container && container.isConnected);
  }

  // Panel de retroalimentación inmediata
  function renderFeedback(q, i) {
    const fb = $('feedback');
    if (!state.revealed[i]) {
      fb.hidden = true;
      fb.innerHTML = '';
      return;
    }
    const ok = isCorrect(q, i);
    fb.hidden = false;
    fb.className = 'bb-feedback ' + (ok ? 'ok' : 'bad');

    let correctStr;
    if (q.isSPR || q.choices.length === 0) {
      correctStr = escapeHTML(q.correct || '');
    } else {
      const letter = (q.correct || '?').toUpperCase();
      const ct = choiceText(q, q.correct);
      correctStr = letter + (ct ? ') ' + escapeHTML(ct) : ')');
    }

    fb.innerHTML = `
      <div class="fb-head">${ok ? '✓ ¡Correcto!' : '✗ Incorrecto'}</div>
      <div class="fb-body">
        <p class="fb-correct">Respuesta correcta: <b>${correctStr}</b></p>
        ${
          q.rationale
            ? `<div class="fb-rationale"><h4>Explicación</h4>${escapeHTML(q.rationale)}</div>`
            : ''
        }
      </div>`;
  }

  function reveal(i) {
    state.revealed[i] = true;
    renderQuestion();
  }

  // Selección de opción de texto (delegación)
  $('choices').addEventListener('click', (e) => {
    const i = state.current;
    if (state.revealed[i]) return;
    const main = e.target.closest('.choice-main');
    const cross = e.target.closest('.choice-cross');
    if (main) {
      const letter = main.dataset.letter;
      const cr = state.crossed[i] || {};
      if (cr[letter]) return;
      state.answers[i] = letter;
      if (state.showAnswers) reveal(i);
      else renderQuestion(); // sin feedback: solo resalta la selección (como el SAT real)
    } else if (cross) {
      const letter = cross.dataset.cross;
      state.crossed[i] = state.crossed[i] || {};
      const map = state.crossed[i];
      map[letter] = !map[letter];
      if (map[letter] && state.answers[i] === letter) delete state.answers[i];
      renderQuestion();
      $('bb-body').classList.add('crossout-mode');
      $('btn-crossout-toggle').classList.add('active');
    }
  });

  // Selección con botones de letra (opciones como imagen)
  $('letters').addEventListener('click', (e) => {
    const i = state.current;
    if (state.revealed[i]) return;
    const btn = e.target.closest('.letter-btn');
    if (!btn) return;
    state.answers[i] = btn.dataset.letter;
    if (state.showAnswers) reveal(i);
    else renderQuestion();
  });

  // Respuesta libre: escribir + comprobar
  $('spr-input').addEventListener('input', (e) => {
    const i = state.current;
    const v = e.target.value.trim();
    state.answers[i] = v;
    $('spr-preview').textContent = v ? `Tu respuesta: ${v}` : '';
    updateNavLabel();
  });
  $('spr-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-spr-check').click();
  });
  $('btn-spr-check').addEventListener('click', () => {
    if (!state.showAnswers) return; // en modo SAT real no se revela la respuesta
    const i = state.current;
    if (!hasAnswer(i)) { toast('Escribe una respuesta primero.'); return; }
    reveal(i);
  });

  // Marcar para revisión
  $('btn-mark').addEventListener('click', () => {
    state.marked[state.current] = !state.marked[state.current];
    renderQuestion();
  });

  // Alternar modo tachar
  $('btn-crossout-toggle').addEventListener('click', function () {
    const on = $('bb-body').classList.toggle('crossout-mode');
    this.classList.toggle('active', on);
  });

  /* ======================================================================
     NAVEGACIÓN
     ====================================================================== */
  function updateNavLabel() {
    const m = currentModule();
    const n = m.endIdx - m.startIdx;
    const rel = state.current - m.startIdx + 1;
    $('nav-label').textContent = `Question ${rel} of ${n}`;
    $('btn-back').disabled = state.current === m.startIdx;
    $('btn-next').textContent = state.current === m.endIdx - 1 ? 'Review' : 'Next';
  }

  $('btn-back').addEventListener('click', () => {
    const m = currentModule();
    if (state.current > m.startIdx) {
      state.current--;
      renderQuestion();
    }
  });
  $('btn-next').addEventListener('click', () => {
    const m = currentModule();
    if (state.current < m.endIdx - 1) {
      state.current++;
      renderQuestion();
    } else {
      gotoReview();
    }
  });

  // Popup navegador
  $('btn-navpop').addEventListener('click', openNavPop);
  $('btn-navpop-close').addEventListener('click', () => ($('navpop').hidden = true));
  $('navpop').addEventListener('click', (e) => {
    if (e.target.id === 'navpop') $('navpop').hidden = true;
  });
  $('btn-review-page').addEventListener('click', () => {
    $('navpop').hidden = true;
    gotoReview();
  });

  function openNavPop() {
    const grid = $('navpop-grid');
    grid.innerHTML = '';
    const m = currentModule();
    for (let i = m.startIdx; i < m.endIdx; i++) {
      const answered = hasAnswer(i);
      const cell = document.createElement('button');
      cell.className =
        'navcell' +
        (answered ? ' answered' : '') +
        (i === state.current ? ' current' : '') +
        (state.marked[i] ? ' marked' : '');
      cell.textContent = i - m.startIdx + 1;
      cell.addEventListener('click', () => {
        state.current = i;
        $('navpop').hidden = true;
        renderQuestion();
      });
      grid.appendChild(cell);
    }
    $('navpop').hidden = false;
  }

  function hasAnswer(i) {
    const a = state.answers[i];
    return a !== undefined && a !== '';
  }

  /* ======================================================================
     DIRECCIONES / MÁS
     ====================================================================== */
  $('btn-directions').addEventListener('click', () => {
    const p = $('directions-panel');
    p.hidden = !p.hidden;
  });
  $('btn-directions-close').addEventListener('click', () => ($('directions-panel').hidden = true));
  // Las herramientas Bluebook (Calculadora, Referencia, More, Highlights & Notes)
  // se implementan en js/tools.js y se enganchan a estos botones desde allí.

  /* ======================================================================
     PÁGINA DE REVISIÓN
     ====================================================================== */
  function gotoReview() {
    clearInterval(state.tick);
    const grid = $('review-grid');
    grid.innerHTML = '';
    const m = currentModule();
    $('review-sub').textContent = 'Módulo: ' + m.label;
    for (let i = m.startIdx; i < m.endIdx; i++) {
      const cell = document.createElement('button');
      cell.className =
        'navcell' + (hasAnswer(i) ? ' answered' : '') + (state.marked[i] ? ' marked' : '');
      cell.textContent = i - m.startIdx + 1;
      cell.addEventListener('click', () => {
        state.current = i;
        show('test');
        renderQuestion();
      });
      grid.appendChild(cell);
    }
    // El botón cambia según si es el último módulo o hay otro después
    const last = isLastModule();
    $('btn-finish').hidden = !last;
    $('btn-finish-module').hidden = last;
    show('review');
  }

  $('btn-back-to-test').addEventListener('click', () => {
    show('test');
    startTimer(); // reanuda el cronómetro del módulo (se pausó al entrar a revisión)
    renderQuestion();
  });
  $('btn-finish').addEventListener('click', finishTest);
  $('btn-finish-module').addEventListener('click', goToBreak);

  /* ======================================================================
     DESCANSO ENTRE MÓDULOS
     ====================================================================== */
  function goToBreak() {
    clearInterval(state.tick);
    const m = currentModule();
    const next = state.modules[state.moduleIndex + 1];
    let answered = 0;
    for (let i = m.startIdx; i < m.endIdx; i++) if (hasAnswer(i)) answered++;

    $('break-title').textContent = `Módulo completado: ${m.label}`;
    $('break-sub').textContent = `${answered} de ${m.endIdx - m.startIdx} preguntas respondidas.`;
    $('break-next-name').textContent = next.label;
    const n = next.endIdx - next.startIdx;
    const mins = next.timerSeconds ? Math.round(next.timerSeconds / 60) + ' min' : 'sin cronómetro';
    $('break-next-meta').textContent = `${n} pregunta${n === 1 ? '' : 's'} · ${mins}`;

    show('break');
  }

  $('btn-start-next-module').addEventListener('click', () => {
    startModule(state.moduleIndex + 1);
  });

  /* ======================================================================
     RESULTADOS
     ====================================================================== */
  function normalizeSPR(v) {
    return (v || '').toString().trim().toLowerCase().replace(/\s+/g, '');
  }

  function isCorrect(q, i) {
    const a = state.answers[i];
    if (a === undefined || a === '') return false;
    if (q.isSPR || q.choices.length === 0) {
      // Acepta variantes: 3/2, 1.5, etc.
      const ans = normalizeSPR(a);
      const correct = normalizeSPR(q.correct);
      if (!correct) return false;
      if (ans === correct) return true;
      // compara valor numérico (incluye fracciones)
      const va = evalNum(ans),
        vc = evalNum(correct);
      return va !== null && vc !== null && Math.abs(va - vc) < 1e-6;
    }
    return a.toUpperCase() === (q.correct || '').toUpperCase();
  }

  function evalNum(s) {
    if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    const f = s.match(/^(-?\d+)\/(\d+)$/);
    if (f) return parseInt(f[1], 10) / parseInt(f[2], 10);
    return null;
  }

  function finishTest() {
    clearInterval(state.tick);
    stopProctor();
    let correct = 0;
    state.questions.forEach((q, i) => {
      if (isCorrect(q, i)) correct++;
    });
    const total = state.questions.length;
    paintResults(correct, total);
    renderSatScore();
    renderResultsList();
    renderProctorSummary();
    show('results');

    // Persistir el intento en la base de datos (salvo que sea una revisión).
    const note = $('results-saved-note');
    if (state.reviewing) {
      if (note) note.hidden = true;
      return;
    }
    if (window.__portal && window.__portal.saveCurrentAttempt) {
      if (note) {
        note.hidden = false;
        note.textContent = '💾 Guardando tu intento…';
      }
      // Antes de guardar, renderiza las imágenes de TODAS las preguntas con figura
      // (aunque no se hayan visto) para que se puedan revisar más adelante.
      prerenderFigures()
        .then(() => window.__portal.saveCurrentAttempt(buildAttemptPayload()))
        .then(() => note && (note.textContent = '✅ Intento guardado en tu historial.'))
        .catch(() => note && (note.textContent = '⚠️ No se pudo guardar el intento (revisa tu conexión).'));
    }
  }

  // Renderiza (y cachea en q._img) la imagen de las preguntas de R&W con figura
  // que aún no se hayan visto, para que queden guardadas y se vean al revisar.
  // Se limita a R&W (pocas por módulo): en Math todas son imágenes y renderizarlas
  // todas sería lento y abultaría el intento; esas se guardan solo si se vieron.
  function prerenderFigures() {
    const jobs = state.questions.map((q) => {
      const isRwFig =
        q.needsImage && q.section === 'rw' && !q.isSPR && q.choices.length > 0 && q.choices.some((c) => c.text);
      if (!isRwFig || q._img || q._imgFailed || !q.geom || !q.srcId) return Promise.resolve();
      const g = q.geom;
      const bottom = g.figureBottom != null ? g.figureBottom : g.cropBottom != null ? g.cropBottom : g.correctY;
      return window.SATParser.renderRegion(q.srcId, g.page, g.stemTopY, bottom)
        .then((url) => {
          q._img = url;
        })
        .catch(() => {
          q._imgFailed = true;
        });
    });
    return Promise.all(jobs);
  }

  function paintResults(correct, total) {
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const moduleLabels = state.modules.map((m) => m.label).join(' + ') || state.title;
    $('results-ring').style.setProperty('--pct', pct);
    $('results-pct').textContent = pct + '%';
    $('results-frac').textContent = `${correct} / ${total}`;
    $('results-summary').textContent =
      (state.reviewing ? 'Revisión — ' : '') +
      `Respondiste correctamente ${correct} de ${total} preguntas ` +
      `(${moduleLabels}). Revisa abajo cada pregunta con su explicación.`;
  }

  // Construye el objeto que se envía al backend para guardar el intento.
  function buildAttemptPayload() {
    // Presupuesto de imágenes: el cuerpo de la petición tiene un límite (~4.5MB en
    // Vercel). Se conservan las imágenes hasta agotar el presupuesto; las que no
    // quepan se guardan sin imagen (al revisar se verá el texto como respaldo).
    // Sin esto, un módulo de Math completo (todas imágenes) podría fallar al guardar.
    let imgBudget = 2500000;
    const questions = state.questions.map((q, i) => {
      let img = q._img || null;
      if (img) {
        if (img.length <= imgBudget) imgBudget -= img.length;
        else img = null;
      }
      return {
        id: q.id,
        section: q.section,
        difficulty: q.difficulty || '',
        domain: q.domain || '',
        stem: q.stem,
        prompt: q.prompt,
        passage: q.passage || '',
        choices: q.choices || [],
        correct: q.correct,
        rationale: q.rationale || '',
        isSPR: !!q.isSPR,
        needsImage: !!q.needsImage,
        type: q.type || '',
        img, // imagen renderizada del PDF (math/figuras), si cabe en el presupuesto
        userAnswer: state.answers[i] !== undefined ? state.answers[i] : null,
        isCorrect: isCorrect(q, i),
      };
    });
    return {
      title: state.title,
      mode: state.mode,
      durationSeconds: state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : null,
      proctorAlerts: state.proctorAlerts.length,
      questions,
    };
  }

  /* ======================================================================
     REVISAR / REHACER un intento guardado
     ====================================================================== */
  function reconstructQuestions(stored) {
    return (stored || []).map((q) => {
      const out = { ...q };
      if (q.img) out._img = q.img; // reutiliza la imagen ya renderizada
      return out;
    });
  }

  function buildModulesFromQuestions(qs) {
    const mods = [];
    qs.forEach((q, i) => {
      const label = q.section === 'math' ? 'Math' : 'Reading and Writing';
      const last = mods[mods.length - 1];
      if (last && last.section === q.section) last.endIdx = i + 1;
      else mods.push({ section: q.section, label, startIdx: i, endIdx: i + 1, timerSeconds: 0 });
    });
    return mods.length
      ? mods
      : [{ section: 'rw', label: 'Examen', startIdx: 0, endIdx: qs.length, timerSeconds: 0 }];
  }

  // Revisar: muestra la pantalla de resultados con las respuestas guardadas (solo lectura).
  function reviewAttempt(attempt) {
    const qs = reconstructQuestions(attempt.questions);
    state.reviewing = true;
    state.mode = attempt.mode || 'review';
    state.title = attempt.title || 'Examen';
    state.questions = qs;
    state.modules = buildModulesFromQuestions(qs);
    state.answers = {};
    state.marked = {};
    state.crossed = {};
    state.revealed = {};
    state.proctorAlerts = new Array(Math.max(0, attempt.proctorAlerts || 0)).fill({});
    state.cameraMonitorEnabled = (attempt.proctorAlerts || 0) > 0;
    qs.forEach((q, i) => {
      if (q.userAnswer !== null && q.userAnswer !== undefined) state.answers[i] = q.userAnswer;
      state.revealed[i] = true;
    });
    let correct = 0;
    qs.forEach((q, i) => {
      if (isCorrect(q, i)) correct++;
    });
    const note = $('results-saved-note');
    if (note) note.hidden = true;
    paintResults(correct, qs.length);
    renderSatScore();
    renderResultsList();
    renderProctorSummary();
    show('results');
  }

  // Practica un conjunto arbitrario de preguntas (rehacer, repaso de errores…).
  function startPractice(questions, opts) {
    opts = opts || {};
    const qs = reconstructQuestions(questions).map((q) => {
      const c = { ...q };
      delete c.userAnswer;
      delete c.isCorrect;
      return c;
    });
    const rw = qs.filter((q) => q.section !== 'math');
    const math = qs.filter((q) => q.section === 'math');
    const mods = [
      rw.length ? { section: 'rw', label: 'Reading and Writing', questions: rw, timerSeconds: 0 } : null,
      math.length ? { section: 'math', label: 'Math', questions: math, timerSeconds: 0 } : null,
    ].filter(Boolean);
    if (!mods.length) return false;
    startModularTest(mods, {
      mode: opts.mode || 'practice',
      title: opts.title || 'Práctica',
      cameraMonitor: !!opts.cameraMonitor,
    });
    return true;
  }

  // Rehacer: reinicia el examen con las mismas preguntas (sin respuestas previas).
  function redoAttempt(attempt) {
    startPractice(attempt.questions, {
      mode: 'redo',
      title: 'Repetición — ' + (attempt.title || 'Examen'),
    });
  }

  function renderProctorSummary() {
    const el = $('results-proctor-summary');
    if (!el) return;
    if (!state.cameraMonitorEnabled) {
      el.hidden = true;
      return;
    }
    const n = state.proctorAlerts.length;
    el.hidden = false;
    el.textContent = n
      ? `📷 Monitoreo por cámara: se detectaron ${n} alerta${n === 1 ? '' : 's'} de movimiento sospechoso durante el examen.`
      : '📷 Monitoreo por cámara: no se detectó ningún movimiento sospechoso. Buen enfoque.';
  }

  // Puntaje estilo SAT digital (400–1600). Usa las tablas de conversión de
  // window.SATScoring (misma curva que el backend) en vez de un porcentaje lineal.
  function renderSatScore() {
    const sec = {
      rw: { c: 0, t: 0, name: 'Reading and Writing' },
      math: { c: 0, t: 0, name: 'Math' },
    };
    state.questions.forEach((q, i) => {
      const k = q.section === 'math' ? 'math' : 'rw';
      sec[k].t++;
      if (isCorrect(q, i)) sec[k].c++;
    });

    const S = window.SATScoring;
    // Respaldo lineal por si scoring.js no cargó (no debería pasar).
    const fallback = (c, t) => (t ? Math.round((200 + (c / t) * 600) / 10) * 10 : null);
    const scores = S
      ? S.computeScores({ rwCorrect: sec.rw.c, rwTotal: sec.rw.t, mathCorrect: sec.math.c, mathTotal: sec.math.t })
      : (() => {
          const rw = fallback(sec.rw.c, sec.rw.t);
          const math = fallback(sec.math.c, sec.math.t);
          let ts = null, est = false;
          if (rw != null && math != null) ts = rw + math;
          else if (rw != null) { ts = rw * 2; est = true; }
          else if (math != null) { ts = math * 2; est = true; }
          return { rwScore: rw, mathScore: math, totalScore: ts, totalEstimated: est };
        })();
    const rw = scores.rwScore;
    const math = scores.mathScore;
    const total = scores.totalScore != null ? scores.totalScore : 0;
    const note = scores.totalEstimated
      ? 'Estimación ×2 a partir de una sola sección (haz ambas para un total real).'
      : 'Suma de ambas secciones (Reading &amp; Writing + Math).';

    const bar = (label, score, s) => {
      if (score == null) return '';
      const pct = Math.round(((score - 200) / 600) * 100);
      return `
        <div class="sat-sec">
          <div class="sat-sec-head">
            <b>${label}</b>
            <span class="sat-sec-score">${score} <span style="opacity:.6;font-weight:400">/ 800</span>
              &nbsp;·&nbsp;<span style="opacity:.7;font-weight:400">${s.c}/${s.t} correctas</span></span>
          </div>
          <div class="sat-bar"><span style="width:${pct}%"></span></div>
        </div>`;
    };

    $('sat-scorecard').innerHTML = `
      <div class="sat-total-label">Puntaje estilo SAT</div>
      <div class="sat-total"><span class="num">${total}</span><span class="max">/ 1600</span></div>
      <p class="sat-total-note">${note}</p>
      <div class="sat-sections">
        ${bar('Reading and Writing', rw, sec.rw)}
        ${bar('Math', math, sec.math)}
      </div>
      <p class="sat-disclaimer">
        Se usa una tabla de conversión con la forma de la curva oficial del SAT digital
        (200–800 por sección, en múltiplos de 10). La escala oficial exacta varía según la
        forma del examen y el equating del College Board, así que este puntaje es una
        estimación fiel a esa curva, no la tabla secreta de un examen concreto.
      </p>`;
  }

  function renderResultsList() {
    const list = $('results-list');
    list.innerHTML = '';
    state.questions.forEach((q, i) => {
      const a = state.answers[i];
      const answered = a !== undefined && a !== '';
      const ok = isCorrect(q, i);
      const cls = !answered ? 'blank' : ok ? 'correct' : 'incorrect';
      const tag = !answered ? 'Sin responder' : ok ? 'Correcta' : 'Incorrecta';

      const yourAns = !answered
        ? '—'
        : q.isSPR || q.choices.length === 0
        ? escapeHTML(a)
        : a.toUpperCase() + ') ' + escapeHTML(choiceText(q, a));
      const correctAns =
        q.isSPR || q.choices.length === 0
          ? escapeHTML(q.correct)
          : (q.correct || '?').toUpperCase() +
            ') ' +
            escapeHTML(choiceText(q, q.correct));

      // Preguntas con figura (Math o R&W con tabla/gráfico): mostrar la imagen,
      // no el texto extraído (que en las figuras sale desordenado).
      const isFig = !!q.needsImage;
      const rwHybrid =
        q.needsImage && q.section === 'rw' && !q.isSPR && q.choices.length > 0 && q.choices.some((c) => c.text);
      const qBody = isFig
        ? '<div class="result-q result-q-img"></div>'
        : `<div class="result-q">${richText(q.prompt).replace(/^<p>|<\/p>$/g, '')}</div>`;

      const item = document.createElement('div');
      item.className = 'result-item ' + cls;
      item.innerHTML = `
        <div class="result-head">
          <span>Pregunta ${i + 1}</span>
          <span class="result-tag ${cls}">${tag}</span>
        </div>
        ${qBody}
        <div class="result-answer">Tu respuesta: <b>${yourAns}</b></div>
        <div class="result-answer">Respuesta correcta: <b>${correctAns}</b></div>
        ${
          q.rationale
            ? `<button class="result-toggle">Ver explicación ▾</button>
               <div class="result-rationale" hidden>${escapeHTML(q.rationale)}</div>`
            : ''
        }`;
      if (isFig) {
        const imgBox = item.querySelector('.result-q-img');
        renderQuestionImage(q, imgBox, rwHybrid);
      }
      const toggle = item.querySelector('.result-toggle');
      if (toggle) {
        toggle.addEventListener('click', () => {
          const r = item.querySelector('.result-rationale');
          r.hidden = !r.hidden;
          toggle.textContent = r.hidden ? 'Ver explicación ▾' : 'Ocultar explicación ▴';
        });
      }
      list.appendChild(item);
    });
  }

  function choiceText(q, letter) {
    const c = q.choices.find((x) => x.letter === (letter || '').toUpperCase());
    return c ? c.text : '';
  }

  $('btn-review-answers').addEventListener('click', () => {
    document.querySelector('.results-list').scrollIntoView({ behavior: 'smooth' });
  });
  $('btn-new-test').addEventListener('click', () => {
    if (window.__portal && window.__portal.goView) window.__portal.goView('import');
    else location.reload();
  });
  const btnDash = $('btn-to-dashboard');
  if (btnDash) {
    btnDash.addEventListener('click', () => {
      if (window.__portal && window.__portal.goView) window.__portal.goView('dashboard');
      else location.reload();
    });
  }

  /* ======================================================================
     PREGUNTAS DE DEMOSTRACIÓN (formato interno ya parseado)
     ====================================================================== */
  const DEMO_QUESTIONS = [
    {
      id: 'demo-1',
      section: 'rw',
      difficulty: 'Medium',
      stem:
        'The following text is adapted from Kate Chopin\'s 1894 short story "The Story of an Hour."\n\nKnowing that Mrs. Mallard was afflicted with a heart trouble, great care was taken to break to her as gently as possible the news of her husband\'s death. It was her sister Josephine who told her, in broken sentences; veiled hints that revealed in half concealing.\n\nWhich choice best describes the overall structure of the text?',
      choices: [
        { letter: 'A', text: 'It presents a conflict and then immediately resolves it.' },
        { letter: 'B', text: 'It establishes a situation and hints at how it will be handled.' },
        { letter: 'C', text: 'It describes a character by contrasting her with another.' },
        { letter: 'D', text: 'It lists a series of events in strict chronological order.' },
      ],
      correct: 'B',
      rationale:
        'Choice B is the best answer. The text first establishes the situation (Mrs. Mallard\'s heart trouble and the death of her husband) and then hints at how the news will be delivered ("great care was taken to break to her as gently as possible").',
      isSPR: false,
    },
    {
      id: 'demo-2',
      section: 'rw',
      difficulty: 'Easy',
      stem:
        'Marine biologist Ayana Elizabeth Johnson has argued that protecting coastal ecosystems such as mangroves is essential ______ these habitats store large amounts of carbon and shield shorelines from storms.\n\nWhich choice completes the text so that it conforms to the conventions of Standard English?',
      choices: [
        { letter: 'A', text: 'because' },
        { letter: 'B', text: 'because,' },
        { letter: 'C', text: ': because' },
        { letter: 'D', text: '; because' },
      ],
      correct: 'A',
      rationale:
        'Choice A is the best answer. The subordinating conjunction "because" correctly joins the dependent clause to the main clause without unnecessary punctuation.',
      isSPR: false,
    },
    {
      id: 'demo-3',
      section: 'math',
      difficulty: 'Medium',
      stem: 'If 3x + 9 = 24, what is the value of x + 3 ?',
      choices: [
        { letter: 'A', text: '5' },
        { letter: 'B', text: '8' },
        { letter: 'C', text: '11' },
        { letter: 'D', text: '15' },
      ],
      correct: 'B',
      rationale:
        'Solving 3x + 9 = 24 gives 3x = 15, so x = 5. Therefore x + 3 = 8. Choice B is correct.',
      isSPR: false,
    },
    {
      id: 'demo-4',
      section: 'math',
      difficulty: 'Hard',
      stem:
        'A line in the xy-plane passes through the points (2, 5) and (6, 13). What is the value of the y-intercept of the line?',
      choices: [],
      correct: '1',
      rationale:
        'The slope is (13 − 5)/(6 − 2) = 8/4 = 2. Using y = 2x + b with the point (2, 5): 5 = 2(2) + b, so b = 1. The y-intercept is 1.',
      isSPR: true,
    },
  ];

  // Exponer estado / funciones para depuración y pruebas
  window.__SAT = state;
  window.__app = {
    startTest, handleFile, renderQuestion, reveal, loadRealFile, real, analyzeSet,
    startModularTest, startModule, currentModule, gotoReview, goToBreak, finishTest,
    reviewAttempt, redoAttempt, startPractice, buildAttemptPayload,
    addToBank, bank, updateBankBadge,
  };
})();
