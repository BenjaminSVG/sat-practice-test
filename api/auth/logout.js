import { destroySession, sendJson } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    await destroySession(req, res);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
