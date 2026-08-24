/* ==========================================================================
   api.js — Wrapper de llamadas al backend (funciones serverless en /api).
   Todas las respuestas son JSON; los errores se lanzan con .message legible.
   ========================================================================== */

(function () {
  'use strict';

  async function req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw new Error('No hay conexión con el servidor.');
    }
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      /* respuesta sin cuerpo JSON */
    }
    if (!res.ok) {
      const err = new Error(data.error || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const HTTP = {
    // Auth
    me: () => req('GET', '/api/auth/me'),
    login: (username, password) => req('POST', '/api/auth/login', { username, password }),
    logout: () => req('POST', '/api/auth/logout'),
    updateAccount: (payload) => req('PATCH', '/api/account', payload),

    // Intentos del alumno
    listAttempts: () => req('GET', '/api/attempts'),
    getAttempt: (id) => req('GET', `/api/attempts/${id}`),
    saveAttempt: (payload) => req('POST', '/api/attempts', payload),
    deleteAttempt: (id) => req('DELETE', `/api/attempts/${id}`),

    // Estadísticas del dashboard
    stats: () => req('GET', '/api/stats'),
    topics: () => req('GET', '/api/stats/topics'),

    // Repaso de errores (opcional: { section, domain })
    mistakes: (params) => {
      const q = new URLSearchParams(params || {}).toString();
      return req('GET', '/api/review/mistakes' + (q ? '?' + q : ''));
    },

    // Panel del profesor
    adminStudent: (id) => req('GET', `/api/admin/student/${id}`),

    // Admin
    adminListUsers: () => req('GET', '/api/admin/users'),
    adminCreateUser: (payload) => req('POST', '/api/admin/users', payload),
    adminUpdateUser: (id, payload) => req('PATCH', `/api/admin/users/${id}`, payload),
    adminDeleteUser: (id) => req('DELETE', `/api/admin/users/${id}`),
  };

  /* ------------------------------------------------------------------------
     Elección de backend. Si el despliegue no tiene base de datos, /api/auth/me
     responde { storage: 'browser' } y todo pasa a guardarse en IndexedDB, en el
     propio equipo del usuario (js/api-local.js). Si no hay servidor de API en
     absoluto (sitio estático), la petición falla y se usa lo mismo.
     ---------------------------------------------------------------------- */
  let picked = null;

  async function pick() {
    if (picked) return picked;
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = res.ok ? await res.json() : null;
      picked = data && data.storage === 'browser' ? window.APILocal : HTTP;
    } catch (_) {
      picked = window.APILocal;
    }
    return picked;
  }

  window.API = {};
  Object.keys(HTTP).forEach((name) => {
    window.API[name] = (...args) => pick().then((backend) => backend[name](...args));
  });
})();
