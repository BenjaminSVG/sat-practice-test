/* ==========================================================================
   scripts/init-db.mjs — Inicializa la base de datos Turso:
     1. Crea todas las tablas e índices (idempotente).
     2. Crea la cuenta 'admin' si no existe, con una contraseña segura
        generada al azar que se imprime UNA sola vez.

   Uso:
     TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/init-db.mjs
   o con un archivo .env (file:./local.db para pruebas locales).
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ensureSchema, getDb } from '../api/_lib/db.js';
import { hashPassword } from '../api/_lib/auth.js';

// Carga .env sencillo si existe (KEY=VALUE por línea) y no está ya en el entorno.
try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  /* sin .env: se usan las variables del entorno */
}

// Genera una contraseña legible pero fuerte.
function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out.slice(0, 6) + '-' + out.slice(6, 12) + '-' + out.slice(12, 16);
}

async function main() {
  console.log('→ Creando esquema…');
  await ensureSchema();
  const db = getDb();

  const existing = await db.execute({
    sql: "SELECT id, username FROM users WHERE role = 'admin' LIMIT 1",
    args: [],
  });

  if (existing.rows.length) {
    console.log(`✓ Ya existe un administrador: "${existing.rows[0].username}". No se crea otro.`);
  } else {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || genPassword();
    const hash = await hashPassword(password);
    await db.execute({
      sql: `INSERT INTO users (username, password_hash, role, display_name, active, created_at)
            VALUES (?, ?, 'admin', ?, 1, ?)`,
      args: [username, hash, 'Administrador', Date.now()],
    });
    console.log('\n========================================');
    console.log('  CUENTA DE ADMINISTRADOR CREADA');
    console.log('  Usuario:    ' + username);
    console.log('  Contraseña: ' + password);
    console.log('  (Guárdala. Podrás cambiarla luego.)');
    console.log('========================================\n');
  }

  console.log('✓ Base de datos lista.');
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Error inicializando la base de datos:', err.message);
  process.exit(1);
});
