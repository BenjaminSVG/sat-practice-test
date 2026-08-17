/* Arranque de la versión local (open source): base de datos SQLite en este mismo
   equipo, sin cuentas ni sesiones. Solo escucha en 127.0.0.1. */
process.env.SAT_LOCAL = '1';
await import('./dev-server.mjs');
