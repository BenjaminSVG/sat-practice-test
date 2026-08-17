# SAT Practice Test — Portal con cuentas, dashboard y base de datos Turso

App full-stack: sitio estático (interfaz estilo Bluebook) + funciones serverless
en Vercel (`/api`) + base de datos **Turso** (libSQL).

## Qué incluye

- **Login obligatorio.** Acceso cerrado: solo el administrador crea cuentas de alumno.
- **Dashboard del alumno** con puntaje promedio, nº de exámenes, precisión y gráfico
  de progresión (estilo "Academic Excellence System").
- **Historial (Mis exámenes):** revisar o **rehacer** cualquier examen anterior.
- **Panel de administración:** crear alumnos, resetear contraseñas, activar/desactivar,
  eliminar; se ve su nº de exámenes y mejor puntaje.
- **Monitoreo por cámara** opcional durante el examen (se procesa en el navegador).
- Toda la interfaz del test (Bluebook), importación de PDF y demostración se conservan.

## Arquitectura

```
/                     → index.html (SPA: login, portal, test, resultados)
/css, /js             → frontend (portal.js, app.js, api.js, proctor.js, pdf-parser.js)
/api/auth/*           → login / logout / me
/api/attempts, /[id]  → guardar, listar, revisar/rehacer, borrar intentos
/api/stats            → agregados del dashboard
/api/admin/users/*    → gestión de alumnos (solo admin)
/api/_lib/db.js       → cliente Turso + esquema (tablas users, sessions, attempts)
/api/_lib/auth.js     → hash de contraseñas (scrypt) + sesiones por cookie httpOnly
/scripts/init-db.mjs  → crea el esquema y la cuenta admin
```

Contraseñas con `scrypt` (nativo de Node, sin dependencias). Sesiones en tabla
`sessions` con cookie `sat_session` HttpOnly/SameSite=Lax, 30 días.

## Puesta en producción (una sola vez)

### 1. Crear la base de datos Turso
En https://turso.tech (o con el CLI):
```bash
turso db create sat-practice
turso db show sat-practice --url          # → TURSO_DATABASE_URL (libsql://...)
turso db tokens create sat-practice       # → TURSO_AUTH_TOKEN
```

### 2. Configurar variables de entorno en Vercel
En el proyecto de Vercel → Settings → Environment Variables (Production):
```
TURSO_DATABASE_URL = libsql://sat-practice-....turso.io
TURSO_AUTH_TOKEN   = <token>
```
O por CLI:
```bash
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
```

### 3. Crear el esquema y la cuenta admin
Con las mismas variables apuntando a Turso:
```bash
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/init-db.mjs
```
Imprime el usuario y la contraseña del admin **una sola vez** (guárdala).
Para elegir tú las credenciales:
```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='tu-clave' TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/init-db.mjs
```

### 4. Desplegar
```bash
vercel --prod
```

## Desarrollo local

```bash
npm install
echo 'TURSO_DATABASE_URL=file:local.db' > .env   # base local en archivo
npm run init-db                                   # crea esquema + admin local
node scripts/dev-server.mjs                        # http://localhost:5199
```
`scripts/dev-server.mjs` sirve los estáticos y enruta `/api/*` igual que Vercel.

## Notas

- El acceso es cerrado por diseño: no hay registro público. El admin crea los alumnos
  desde la pestaña **Admin**.
- Cada intento guarda una instantánea completa de las preguntas y respuestas, por lo que
  **Revisar** y **Rehacer** funcionan sin volver a subir el PDF.
- El puntaje estilo SAT (200–800 por sección) es una estimación por porcentaje de aciertos;
  no sustituye la tabla oficial del College Board.
