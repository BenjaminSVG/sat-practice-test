import { getSessionUser, sendJson, LOCAL_MODE } from '../_lib/auth.js';

export default async function handler(req, res) {
  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 200, { user: null, localMode: LOCAL_MODE });
    return sendJson(res, 200, { user, localMode: LOCAL_MODE });
  } catch (err) {
    return sendJson(res, 500, { error: 'Error del servidor: ' + err.message });
  }
}
