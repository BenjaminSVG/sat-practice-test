import { getSessionUser, sendJson, LOCAL_MODE } from '../_lib/auth.js';

// Despliegue sin base de datos (ni Turso ni SQLite local): no hay dónde guardar
// nada en el servidor, así que se le dice al navegador que use su propio
// almacenamiento (IndexedDB). Ver js/api.js y js/api-local.js.
const NO_DATABASE = !process.env.TURSO_DATABASE_URL && process.env.SAT_LOCAL !== '1';

export default async function handler(req, res) {
  if (NO_DATABASE) return sendJson(res, 200, { user: null, storage: 'browser' });
  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 200, { user: null, localMode: LOCAL_MODE });
    return sendJson(res, 200, { user, localMode: LOCAL_MODE });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
