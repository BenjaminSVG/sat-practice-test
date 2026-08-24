/* ==========================================================================
   api-local.js — Almacenamiento en el propio navegador (IndexedDB), para el
   despliegue sin base de datos: los intentos NUNCA salen del equipo del
   usuario. Expone la misma superficie que window.API (ver js/api.js), así que
   portal.js y app.js no distinguen si hablan con el servidor o con el disco
   local. Se usa IndexedDB y no localStorage porque un intento puede llevar
   varios MB de figuras renderizadas del PDF (localStorage topa en ~5MB).
   ========================================================================== */

(function () {
  'use strict';

  const DB_NAME = 'sat_practice_local';
  const STORE = 'attempts';
  const NAME_KEY = 'sat_local_display_name';

  function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('No se pudo abrir el almacenamiento del navegador.'));
    });
  }

  function promise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Error de almacenamiento'));
    });
  }

  async function store(mode) {
    const db = await openDb();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  // Todos los intentos, del más reciente al más antiguo.
  async function allAttempts() {
    const s = await store('readonly');
    const rows = await promise(s.getAll());
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  // Resumen para el historial: todo menos el JSON pesado de preguntas.
  function summary(a) {
    const { questions, ...rest } = a;
    return rest;
  }

  /* ---------------- Guardado ---------------- */
  // Mismo cálculo que api/attempts/index.js. Aquí no hace falta recalificar en
  // un servidor de confianza: no hay servidor, y el único dato en juego es el
  // del propio alumno en su propia máquina.
  function computeStats(questions) {
    let correct = 0, rwTotal = 0, rwCorrect = 0, mathTotal = 0, mathCorrect = 0;
    for (const q of questions) {
      const isMath = q.section === 'math';
      if (isMath) mathTotal++;
      else rwTotal++;
      if (q.isCorrect) {
        correct++;
        if (isMath) mathCorrect++;
        else rwCorrect++;
      }
    }
    const { rwScore, mathScore, totalScore } = window.SATScoring.computeScores({
      rwCorrect, rwTotal, mathCorrect, mathTotal,
    });
    return {
      total: questions.length, correct,
      rwTotal, rwCorrect, mathTotal, mathCorrect,
      rwScore, mathScore, totalScore,
    };
  }

  async function saveAttempt(payload) {
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    const s = computeStats(questions);
    const record = {
      title: String(payload.title || 'Examen de práctica').slice(0, 160),
      mode: String(payload.mode || 'quick').slice(0, 32),
      createdAt: Date.now(),
      totalQuestions: s.total,
      correctCount: s.correct,
      rwTotal: s.rwTotal,
      rwCorrect: s.rwCorrect,
      mathTotal: s.mathTotal,
      mathCorrect: s.mathCorrect,
      rwScore: s.rwScore,
      mathScore: s.mathScore,
      totalScore: s.totalScore,
      durationSeconds: Number.isFinite(payload.durationSeconds)
        ? Math.max(0, Math.round(payload.durationSeconds)) : null,
      proctorAlerts: Number.isFinite(payload.proctorAlerts)
        ? Math.max(0, Math.round(payload.proctorAlerts)) : 0,
      questions,
    };
    const st = await store('readwrite');
    let id;
    try {
      id = await promise(st.add(record));
    } catch (e) {
      // Cuota del navegador agotada: hay que borrar intentos antiguos.
      throw new Error('No hay espacio en el navegador para guardar el intento. Borra exámenes antiguos del historial.');
    }
    return { id: Number(id), stats: s };
  }

  /* ---------------- Estadísticas (equivalente a /api/stats) ---------------- */
  async function stats() {
    const rows = (await allAttempts()).slice().reverse(); // ascendente por fecha
    const withScore = rows.filter((x) => x.totalScore != null);
    const avgScore = withScore.length
      ? Math.round(withScore.reduce((a, x) => a + x.totalScore, 0) / withScore.length)
      : null;
    const lastDelta = withScore.length >= 2
      ? withScore[withScore.length - 1].totalScore - withScore[withScore.length - 2].totalScore
      : null;
    const maxOrNull = (arr) => {
      const nums = arr.filter((v) => v != null);
      return nums.length ? Math.max(...nums) : null;
    };
    let totalQ = 0, totalCorrect = 0;
    rows.forEach((x) => {
      totalQ += x.totalQuestions;
      totalCorrect += x.correctCount;
    });
    return {
      stats: {
        testsCompleted: rows.length,
        avgScore,
        lastDelta,
        bestRw: maxOrNull(rows.map((x) => x.rwScore)),
        bestMath: maxOrNull(rows.map((x) => x.mathScore)),
        accuracy: totalQ ? Math.round((totalCorrect / totalQ) * 100) : null,
        lastScore: withScore.length ? withScore[withScore.length - 1].totalScore : null,
        progression: withScore.slice(-12).map((x) => ({
          id: x.id, title: x.title, createdAt: x.createdAt, totalScore: x.totalScore,
        })),
      },
    };
  }

  /* ---------------- Desglose por tema (equivalente a /api/stats/topics) ---------------- */
  const SECTION_NAME = { rw: 'Reading and Writing', math: 'Math' };

  async function topics() {
    const rows = await allAttempts();
    const sections = {
      rw: { key: 'rw', name: SECTION_NAME.rw, total: 0, correct: 0, domains: [] },
      math: { key: 'math', name: SECTION_NAME.math, total: 0, correct: 0, domains: [] },
    };
    const byDomain = {};
    for (const a of rows) {
      for (const q of a.questions || []) {
        const sec = q.section === 'math' ? 'math' : 'rw';
        const domain = (q.domain && String(q.domain).trim()) || 'General';
        const key = sec + '|' + domain;
        if (!byDomain[key]) byDomain[key] = { sec, domain, total: 0, correct: 0 };
        byDomain[key].total++;
        sections[sec].total++;
        if (q.isCorrect) {
          byDomain[key].correct++;
          sections[sec].correct++;
        }
      }
    }
    Object.values(byDomain)
      .sort((a, b) => b.total - a.total)
      .forEach((d) => {
        sections[d.sec].domains.push({
          domain: d.domain,
          total: d.total,
          correct: d.correct,
          accuracy: d.total ? Math.round((d.correct / d.total) * 100) : 0,
        });
      });
    const out = [];
    ['rw', 'math'].forEach((k) => {
      const s = sections[k];
      s.accuracy = s.total ? Math.round((s.correct / s.total) * 100) : null;
      if (s.total) out.push(s);
    });
    return { topics: out };
  }

  /* ---------------- Repaso de errores (equivalente a /api/review/mistakes) ---------------- */
  async function mistakes(params) {
    const p = params || {};
    const section = p.section === 'math' || p.section === 'rw' ? p.section : null;
    const domain = p.domain ? String(p.domain) : null;
    const limit = Math.min(60, Math.max(1, parseInt(p.limit, 10) || 40));
    const rows = (await allAttempts()).slice(0, 40);
    const seen = new Set();
    const out = [];
    for (const a of rows) {
      for (const q of a.questions || []) {
        if (q.isCorrect) continue; // solo errores
        const key = (q.section || '') + '|' + (q.id || '');
        if (seen.has(key)) continue; // dedup: se queda la versión más reciente
        seen.add(key);
        if (section && q.section !== section) continue;
        if (domain && (q.domain || 'General') !== domain) continue;
        const c = { ...q };
        delete c.userAnswer;
        delete c.isCorrect;
        out.push(c);
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    return { questions: out, count: out.length };
  }

  /* ---------------- Superficie pública ---------------- */
  const noAccounts = () =>
    Promise.reject(new Error('Esta versión no usa cuentas: tus datos se guardan en este navegador.'));

  window.APILocal = {
    me: async () => ({
      user: {
        id: 1,
        username: 'local',
        role: 'student',
        displayName: localStorage.getItem(NAME_KEY) || 'Estudiante',
      },
      localMode: true,
    }),
    login: noAccounts,
    logout: async () => ({ ok: true }),
    updateAccount: async (payload) => {
      if (payload && payload.newPassword) throw new Error('Esta versión no usa contraseñas.');
      const name =
        payload && typeof payload.displayName === 'string' ? payload.displayName.trim().slice(0, 80) : '';
      if (name) localStorage.setItem(NAME_KEY, name);
      return { ok: true, displayName: localStorage.getItem(NAME_KEY) || 'Estudiante' };
    },

    listAttempts: async () => ({ attempts: (await allAttempts()).map(summary) }),
    getAttempt: async (id) => {
      const s = await store('readonly');
      const a = await promise(s.get(Number(id)));
      if (!a) throw new Error('Intento no encontrado');
      return { attempt: a };
    },
    saveAttempt,
    deleteAttempt: async (id) => {
      const s = await store('readwrite');
      await promise(s.delete(Number(id)));
      return { ok: true };
    },

    stats,
    topics,
    mistakes,

    adminStudent: noAccounts,
    adminListUsers: noAccounts,
    adminCreateUser: noAccounts,
    adminUpdateUser: noAccounts,
    adminDeleteUser: noAccounts,
  };
})();
