# SAT Practice Test

Examen de práctica del SAT con la **misma interfaz del SAT digital (Bluebook)**, que
importa un PDF de preguntas exportado del
[SAT Suite Question Bank del College Board](https://satsuiteeducatorquestionbank.collegeboard.org/)
y guarda tu progreso en **una base de datos en tu propio equipo**.

Sin cuentas, sin login, sin nube: los datos no salen de tu computadora.

## Dos formas de usarlo (en las dos, tus datos son tuyos)

| | Dónde se guarda tu progreso |
|---|---|
| **Versión web**: <https://satpracticeopen.vercel.app> | En **tu navegador** (IndexedDB). El servidor no tiene base de datos: nada de lo que haces sale de tu equipo. Se borra si limpias los datos del navegador. |
| **Instalada en tu PC** (abajo) | En un archivo **SQLite** (`local.db`) dentro de la carpeta del proyecto. |

## Instalar y usar

Requiere [Node.js](https://nodejs.org) 18 o superior.

```bash
git clone https://github.com/<usuario>/sat-practice-test.git
cd sat-practice-test
npm install
npm start          # abre http://localhost:5199
```

No hay más pasos: la base de datos (`local.db`, SQLite) se crea sola en la carpeta
del proyecto la primera vez. Para borrar todo tu historial, borra ese archivo.

## Cómo obtener el PDF de preguntas

1. Entra a <https://satsuiteeducatorquestionbank.collegeboard.org/>.
2. Filtra (Assessment: SAT, Test: Reading and Writing o Math, dominio, dificultad).
3. Selecciona las preguntas y usa **Export / Download** para generar el PDF.
4. Impórtalo en la app (arrastrar y soltar).

Este repositorio **no incluye** preguntas del College Board: tú aportas tu propio PDF.
Si solo quieres ver la interfaz, usa **"Ver demostración con preguntas de ejemplo"**.

## Qué incluye

- **Interfaz Bluebook**: pasaje a la izquierda, pregunta a la derecha, cronómetro
  ocultable, navegador de preguntas y página de revisión ("Check Your Work").
- **Herramientas del examen real**: marcar para revisión, tachar opciones,
  resaltar texto, calculadora (Desmos) y hoja de referencia en Math.
- **Preguntas de respuesta libre** (grid-in / SPR).
- **Puntuación estilo SAT** (200–800 por sección) con tablas de conversión
  aproximadas a las oficiales del College Board.
- **Dashboard de progreso**: puntaje promedio, precisión, gráfico de progresión y
  desglose por tema y subtema.
- **Historial**: revisar o **rehacer** cualquier examen anterior sin volver a subir el PDF.
- **Repaso de errores** filtrado por sección y tema.
- **Monitoreo por cámara** opcional durante el examen (se procesa en el navegador;
  no se sube ni se graba nada).

## Estructura

```
index.html            SPA: portal, test, revisión y resultados
js/portal.js          Dashboard, historial, repaso de errores
js/app.js             Motor del examen: cronómetro, navegación, corrección
js/pdf-parser.js      Lectura del PDF del College Board (PDF.js)
js/scoring.js         Conversión de aciertos a escala 200–800
js/api-local.js       Guardado en el navegador (IndexedDB) cuando no hay base
api/                  Endpoints HTTP (intentos, estadísticas, repaso)
api/_lib/db.js        Cliente SQLite (libSQL) + esquema
scripts/start-local.mjs  Servidor local (127.0.0.1)
```

## Notas

- El servidor solo escucha en `127.0.0.1`: la app no pide contraseña, así que no
  queda accesible desde otros equipos de tu red.
- El parser extrae **texto**. Preguntas cuya figura está incrustada como imagen
  pueden no capturarse completas; enunciado, opciones, respuesta y explicación sí.
- El puntaje 200–800 es una estimación fiel a la curva real, no la tabla de
  equating de un examen concreto.

## Modo multiusuario (opcional)

El mismo código admite un despliegue con cuentas de alumno, panel de administración
y base de datos remota (Turso). Ver [SETUP.md](SETUP.md). El modo local se activa
con la variable `SAT_LOCAL=1` que pone `npm start`; sin ella, se usa el modo con login.

## Licencia

MIT — ver [LICENSE](LICENSE). No afiliado al College Board; SAT y Bluebook son
marcas de sus respectivos propietarios.
