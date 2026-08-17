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

  window.API = {
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
})();
