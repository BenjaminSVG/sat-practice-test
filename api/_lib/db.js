/* ==========================================================================
   api/_lib/db.js — Cliente de base de datos Turso (libSQL) + esquema.
   Se usa el mismo cliente para producción (libsql://…) y para desarrollo
   local (file:./local.db). Las variables de entorno se toman de Vercel.
   ========================================================================== */

import { createClient } from '@libsql/client';

let _client = null;

export function getDb() {
  if (_client) return _client;
  // En modo local la base es un archivo SQLite junto al proyecto: sin nube,
  // sin cuenta y sin configuración previa.
  const url =
    process.env.TURSO_DATABASE_URL ||
    (process.env.SAT_LOCAL === '1' ? 'file:local.db' : null);
  if (!url) {
    throw new Error(
      'Falta TURSO_DATABASE_URL. Configúrala en Vercel (o en un .env local, p. ej. file:./local.db).'
    );
  }
  _client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN, // no requerido para file:
  });
  return _client;
}

/* --------------------------------------------------------------------------
   Esquema. Diseñado para consultas rápidas del dashboard:
   - Las columnas agregadas (correct_count, *_score, etc.) permiten calcular
     estadísticas sin abrir el JSON pesado de cada intento.
   - questions_json guarda la instantánea completa (preguntas + respuestas)
     para poder REVISAR o REHACER el examen, y solo se descarga bajo demanda.
   -------------------------------------------------------------------------- */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     username      TEXT    NOT NULL,
     password_hash TEXT    NOT NULL,
     role          TEXT    NOT NULL DEFAULT 'student',
     display_name  TEXT,
     active        INTEGER NOT NULL DEFAULT 1,
     created_at    INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`,

  `CREATE TABLE IF NOT EXISTS sessions (
     token      TEXT    PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,

  `CREATE TABLE IF NOT EXISTS attempts (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title            TEXT    NOT NULL,
     mode             TEXT,
     created_at       INTEGER NOT NULL,
     total_questions  INTEGER NOT NULL DEFAULT 0,
     correct_count    INTEGER NOT NULL DEFAULT 0,
     rw_total         INTEGER NOT NULL DEFAULT 0,
     rw_correct       INTEGER NOT NULL DEFAULT 0,
     math_total       INTEGER NOT NULL DEFAULT 0,
     math_correct     INTEGER NOT NULL DEFAULT 0,
     rw_score         INTEGER,
     math_score       INTEGER,
     total_score      INTEGER,
     duration_seconds INTEGER,
     proctor_alerts   INTEGER NOT NULL DEFAULT 0,
     questions_json   TEXT    NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_attempts_user_created ON attempts(user_id, created_at DESC)`,

  // Desglose por tema (section) y subtema (domain) de cada intento. Se calcula al
  // guardar para que las estadísticas por tema se agreguen con SQL, sin abrir JSON.
  `CREATE TABLE IF NOT EXISTS attempt_topics (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
     user_id    INTEGER NOT NULL,
     section    TEXT    NOT NULL,
     domain     TEXT    NOT NULL,
     total      INTEGER NOT NULL DEFAULT 0,
     correct    INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_topics_user ON attempt_topics(user_id, section, domain)`,
  `CREATE INDEX IF NOT EXISTS idx_topics_attempt ON attempt_topics(attempt_id)`,

  // Límite de intentos de login fallidos (fuerza bruta). Una fila por nombre
  // de usuario intentado (exista o no la cuenta); se borra al iniciar sesión bien.
  `CREATE TABLE IF NOT EXISTS login_attempts (
     username     TEXT    PRIMARY KEY,
     failed_count INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER
   )`,
];

let _schemaReady = null;

// Crea las tablas si no existen (idempotente). Se cachea por instancia.
export async function ensureSchema() {
  if (_schemaReady) return _schemaReady;
  const db = getDb();
  _schemaReady = (async () => {
    for (const stmt of SCHEMA) {
      await db.execute(stmt);
    }
  })();
  return _schemaReady;
}
