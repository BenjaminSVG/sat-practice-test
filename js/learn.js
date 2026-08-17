/* ============================================================================
   Módulo "Aprender" — selector de examen + tips + modos divertidos.
   Autocontenido: sin backend, sin dependencias. Progreso (XP/mejor racha) en
   localStorage. Se cuelga de window.__learn para que portal.js lo invoque.
   ========================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CARD =
    'bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm';
  const esc = (s) =>
    (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );

  /* -------------------------------------------------------------- contenido */
  // Cada examen: tips por categoría, flashcards (concepto→definición) y quiz.
  const EXAMS = {
    SAT: {
      icon: '📘',
      name: 'SAT',
      blurb: 'College Board — Reading & Writing + Math.',
      tips: {
        Math: [
          'Sustituye números concretos cuando el problema es abstracto (variables): elige valores fáciles y prueba las opciones.',
          'Antes de resolver una ecuación, mira las opciones: a veces "backsolving" (probar respuestas) es más rápido.',
          'Memoriza que pendiente = (y2−y1)/(x2−x1). La mitad de Álgebra del SAT es leer pendiente e intercepto.',
          'En sistemas: si los coeficientes son múltiplos, suma/resta las ecuaciones en vez de despejar.',
          'Usa la hoja de referencia para áreas y volúmenes — no la memorices, pero sí sábela ubicar rápido.',
        ],
        Reading: [
          'Lee la pregunta ANTES del pasaje corto: sabrás qué cazar.',
          'En "palabra en contexto", tapa la palabra y rellena el hueco con la tuya; luego busca la opción más parecida.',
          'Cada respuesta correcta tiene evidencia literal en el texto. Si tienes que suponer demasiado, es trampa.',
          'En gramática, lee la frase completa en voz baja: el oído detecta concordancia y comas mal puestas.',
          'Elimina primero. Dos opciones suelen ser claramente falsas; decide entre las dos que quedan.',
        ],
      },
      flashcards: [
        ['Pendiente (slope)', '(y₂−y₁)/(x₂−x₁): cuánto sube y por cada x.'],
        ['Forma pendiente-intercepto', 'y = mx + b, donde m=pendiente, b=corte con y.'],
        ['Media vs mediana', 'Media = promedio; mediana = valor central ordenado.'],
        ['Probabilidad', 'casos favorables / casos totales.'],
        ['Independent clause', 'Grupo de palabras con sujeto y verbo que funciona como oración completa.'],
      ],
      quiz: [
        ['Si 3x + 6 = 21, ¿cuánto vale x?', ['3', '5', '7', '9'], 1, '3x=15 → x=5.'],
        ['La pendiente de la recta y = −2x + 4 es:', ['4', '−2', '2', '−4'], 1, 'En y=mx+b, m=−2.'],
        ['"Elated" significa más cercano a:', ['Triste', 'Muy feliz', 'Cansado', 'Enojado'], 1, 'Elated = eufórico/muy feliz.'],
        ['Si f(x)=2x²−3 y x=4, entonces f(4)=', ['29', '13', '32', '5'], 0, '2·16−3=32−3=29.'],
        ['El 20% de 150 es:', ['20', '30', '15', '45'], 1, '0.20·150=30.'],
        ['Media de 4, 8, 10, 10:', ['8', '9', '7', '10'], 0, '(4+8+10+10)/4=32/4=8.'],
        ['Elige la opción sin error: "Neither the coach nor the players ___ ready."', ['is', 'are', 'was', 'be'], 1, 'El verbo concuerda con el sujeto más cercano (players → are).'],
        ['Si x/5 = 12, entonces x =', ['60', '17', '2.4', '7'], 0, 'x=12·5=60.'],
        ['"Ambiguous" significa:', ['Claro', 'Con doble sentido', 'Falso', 'Largo'], 1, 'Ambiguo = admite más de una interpretación.'],
        ['Área de un círculo de radio 3 (usa πr²):', ['6π', '9π', '3π', '12π'], 1, 'π·3²=9π.'],
        ['La probabilidad de sacar cara en una moneda justa:', ['1', '1/2', '1/4', '0'], 1, 'Un caso favorable de dos.'],
        ['El guion largo (em dash) en una oración sirve para:', ['Terminar la frase', 'Insertar un inciso con énfasis', 'Unir dos palabras', 'Nada'], 1, 'Aísla un inciso, como paréntesis con más énfasis.'],
      ],
    },
    GMAT: {
      icon: '📊',
      name: 'GMAT',
      blurb: 'Business school — Quant, Verbal y Data Insights.',
      tips: {
        Quant: [
          'Data Sufficiency: no resuelvas — decide si CADA dato basta. Evalúa (1) y (2) por separado antes de juntarlos.',
          'Aprende a estimar: muchas preguntas se ganan por magnitud, no por cálculo exacto.',
          'Domina propiedades de números (par/impar, primos, divisibilidad): aparecen en disfraz.',
        ],
        Verbal: [
          'Critical Reasoning: identifica conclusión y premisa antes de mirar opciones. La respuesta ataca o defiende ese salto.',
          'Sentence Correction: prioriza significado y concordancia sobre "sonido". Lo conciso suele ganar.',
          'En Reading Comp, quédate con la estructura (para qué está cada párrafo), no memorices detalles.',
        ],
      },
      flashcards: [
        ['Data Sufficiency', 'Preguntan si los datos BASTAN para responder, no la respuesta.'],
        ['Weaken the argument', 'Buscar la opción que rompe el supuesto entre premisa y conclusión.'],
        ['Assumption', 'Puente no dicho que la conclusión necesita para sostenerse.'],
      ],
      quiz: [
        ['En Data Sufficiency, ¿qué evalúas primero?', ['Ambos datos juntos', 'Cada dato por separado', 'Solo el (2)', 'Las opciones'], 1, 'Siempre (1) y (2) por separado antes de combinar.'],
        ['Un número par × cualquier entero da:', ['Impar', 'Par', 'Primo', 'Depende'], 1, 'Par × entero siempre es par.'],
        ['¿Cuántos primos hay entre 1 y 10?', ['3', '4', '5', '2'], 1, '2, 3, 5, 7 → cuatro.'],
        ['Si x²=49, los valores de x son:', ['Solo 7', '7 y −7', 'Solo −7', '24.5'], 1, 'Raíz cuadrada da ± : 7 y −7.'],
        ['En Critical Reasoning, la "assumption" es:', ['La conclusión', 'Un supuesto no dicho que sostiene el argumento', 'Un dato del texto', 'La opción larga'], 1, 'Puente implícito entre premisa y conclusión.'],
        ['Para "weaken" un argumento buscas la opción que:', ['Repite la conclusión', 'Rompe el supuesto', 'Añade un ejemplo a favor', 'Define un término'], 1, 'Ataca el vínculo premisa-conclusión.'],
        ['Sentence Correction premia lo:', ['Más largo', 'Más conciso y claro', 'Más formal', 'Con más comas'], 1, 'A igualdad de significado, gana lo conciso y correcto.'],
        ['Si un precio sube 25% y luego baja 20%, el neto es:', ['+5%', '0%', '−5%', '+45%'], 1, '1.25·0.80=1.00 → sin cambio.'],
        ['El promedio de 6 números es 10; su suma es:', ['16', '60', '10', '6'], 1, 'suma = media·cantidad = 60.'],
        ['Un ángulo recto mide:', ['45°', '90°', '180°', '60°'], 1, 'Recto = 90 grados.'],
      ],
    },
    TOEFL: {
      icon: '🎧',
      name: 'TOEFL iBT',
      blurb: 'Inglés académico — Reading, Listening, Speaking, Writing.',
      tips: {
        Reading: [
          'Salta a las preguntas y regresa al párrafo referido; no leas todo palabra por palabra.',
          'Las preguntas de vocabulario preguntan el sentido EN CONTEXTO, no la definición del diccionario.',
        ],
        Listening: [
          'Toma notas de estructura: tema, ejemplos, cambios de opinión. No transcribas.',
          'Escucha el tono del profesor: énfasis y pausas marcan lo evaluable.',
        ],
        Speaking: [
          'Usa plantillas: "In my opinion… First… For example… That\'s why…". Da fluidez bajo presión.',
          'Habla los 45–60 s completos. Silencio penaliza más que un error pequeño.',
        ],
        Writing: [
          'Integrated: resume lo leído y contrasta con lo escuchado. No des tu opinión.',
          'Independent: 4–5 párrafos, tesis clara, 2 razones con ejemplos concretos.',
        ],
      },
      flashcards: [
        ['Integrated Writing', 'Combinar un texto + una charla: reportar cómo se relacionan (sin opinión).'],
        ['Paraphrase', 'Decir lo mismo con otras palabras — clave para no copiar el audio.'],
        ['Signpost words', 'However, therefore, for instance… guían la estructura del discurso.'],
      ],
      quiz: [
        ['En Integrated Writing debes:', ['Dar tu opinión', 'Relacionar lectura y audio', 'Escribir un cuento', 'Traducir'], 1, 'Reportas la relación entre ambas fuentes, sin opinar.'],
        ['¿Cuánto deberías hablar en cada respuesta de Speaking?', ['10 s', 'Los 45–60 s completos', 'Lo mínimo', '3 min'], 1, 'Aprovecha todo el tiempo; el silencio penaliza.'],
        ['El TOEFL iBT evalúa, en orden:', ['Speaking, Reading…', 'Reading, Listening, Speaking, Writing', 'Solo Reading', 'Writing, Reading'], 1, 'Ese es el orden de las cuatro secciones.'],
        ['En preguntas de vocabulario debes elegir el sentido:', ['Del diccionario', 'En contexto', 'Más largo', 'Más raro'], 1, 'Siempre el significado según el pasaje.'],
        ['Buena técnica al escuchar una lecture:', ['Transcribir todo', 'Notas de estructura (tema, ejemplos)', 'No anotar', 'Solo el final'], 1, 'Capta la organización, no cada palabra.'],
        ['"However" es una palabra de:', ['Ejemplo', 'Contraste', 'Causa', 'Tiempo'], 1, 'Marca contraste/oposición.'],
        ['El puntaje total del TOEFL iBT va de:', ['0–100', '0–120', '0–9', '200–800'], 1, '30 por sección × 4 = 120.'],
        ['En Independent Writing, buena estructura:', ['1 párrafo', 'Tesis + 2 razones con ejemplos + cierre', 'Lista', 'Diálogo'], 1, 'Introducción, cuerpos con razones y conclusión.'],
        ['"Paraphrase" significa:', ['Copiar textual', 'Decir lo mismo con otras palabras', 'Resumir en 1 palabra', 'Traducir'], 1, 'Reformular sin copiar.'],
      ],
    },
    IELTS: {
      icon: '🌍',
      name: 'IELTS',
      blurb: 'Inglés (British Council) — Listening, Reading, Writing, Speaking.',
      tips: {
        Reading: [
          '"True/False/Not Given": Not Given = el texto NO lo dice, aunque suene lógico. No infieras.',
          'Cuida la ortografía: una palabra mal escrita se marca mal aunque la entiendas.',
        ],
        Writing: [
          'Task 1 (académico): describe tendencias del gráfico (sube, cae, se estabiliza) con datos, sin opinar.',
          'Task 2 vale más: responde TODA la pregunta, párrafos con una idea cada uno.',
        ],
        Speaking: [
          'Part 2 (cue card): usa el minuto de preparación para 3–4 viñetas. Habla 2 min sin cortarte.',
          'Extiende cada respuesta: "Yes, because…". Respuestas de una palabra bajan la nota.',
        ],
      },
      flashcards: [
        ['Not Given', 'La afirmación no aparece ni se contradice en el texto — no deducir.'],
        ['Band score', 'Escala 0–9; se promedian las 4 secciones.'],
        ['Cue card', 'Tarjeta con tema de Speaking Part 2; hablas ~2 minutos.'],
      ],
      quiz: [
        ['En "True/False/Not Given", "Not Given" significa:', ['Es falso', 'El texto no lo menciona', 'Es verdadero', 'Es opinión'], 1, 'La info no está ni confirmada ni negada en el texto.'],
        ['El IELTS se puntúa en bandas de:', ['0 a 100', '0 a 9', 'A a F', '1 a 5'], 1, 'Band score de 0 a 9.'],
        ['El IELTS tiene versión:', ['Solo académica', 'Academic y General Training', 'Solo oral', 'Solo escrita'], 1, 'Dos módulos según el objetivo.'],
        ['En Writing Task 1 (Academic) describes:', ['Tu opinión', 'Datos de un gráfico/tabla', 'Un cuento', 'Una carta'], 1, 'Resumes tendencias del visual, sin opinar.'],
        ['Writing Task 2 comparado con Task 1:', ['Vale menos', 'Vale más', 'Igual', 'No cuenta'], 1, 'Task 2 pesa más en la nota de Writing.'],
        ['En Speaking Part 2 hablas aproximadamente:', ['30 s', '2 min', '5 min', '10 s'], 1, 'Monólogo de ~2 minutos tras 1 min de preparación.'],
        ['Una respuesta de una sola palabra en Speaking:', ['Sube la nota', 'Baja la nota', 'No afecta', 'Es ideal'], 1, 'Debes extender con razones y ejemplos.'],
        ['La ortografía en Reading/Listening:', ['No importa', 'Cuenta: mal escrito = incorrecto', 'Solo en Writing', 'Es opcional'], 1, 'Se marca mal aunque entiendas la palabra.'],
      ],
    },
    DET: {
      icon: '🦉',
      name: 'Duolingo English Test',
      blurb: 'Examen adaptativo, corto y en línea.',
      tips: {
        General: [
          'Es adaptativo: si aciertas, sube la dificultad. Contesta con calma, cada ítem pesa.',
          '"Read and complete": usa el contexto de la frase para deducir letras faltantes.',
          'En "Listen and type", escribe exactamente lo que oyes; los tiempos verbales cuentan.',
        ],
        Speaking: [
          'Habla claro y a ritmo natural; el sistema evalúa fluidez y pronunciación, no acento perfecto.',
          'Da respuestas completas con ejemplos; llena el tiempo disponible.',
        ],
        Writing: [
          'Escribe más de lo mínimo pero con sentido: variedad de vocabulario y conectores suman.',
          'Revisa concordancia y ortografía al final; errores tontos bajan la nota.',
        ],
      },
      flashcards: [
        ['Adaptativo', 'La dificultad sube o baja según tus aciertos en tiempo real.'],
        ['Read and complete', 'Rellenar letras faltantes de palabras usando el contexto.'],
        ['Elicited imitation', 'Escuchar una frase y repetirla exactamente.'],
      ],
      quiz: [
        ['El Duolingo English Test es:', ['Fijo para todos', 'Adaptativo', 'Solo oral', 'En papel'], 1, 'Ajusta la dificultad según tu desempeño.'],
        ['En "Listen and type" debes escribir:', ['Un resumen', 'Exactamente lo que oyes', 'Tu opinión', 'Solo verbos'], 1, 'Transcripción literal de lo escuchado.'],
        ['El DET se hace:', ['En un centro', 'En línea desde casa', 'En papel', 'Por teléfono'], 1, 'Online, con supervisión remota.'],
        ['"Read and complete" pide:', ['Traducir', 'Rellenar letras faltantes por contexto', 'Resumir', 'Hablar'], 1, 'Deduces las letras usando la frase.'],
        ['El puntaje del DET va de:', ['0–120', '10–160', '0–9', '200–800'], 1, 'Escala de 10 a 160.'],
        ['Si aciertas seguido, la dificultad:', ['Baja', 'Sube', 'Se mantiene', 'Termina el test'], 1, 'Adaptativo: sube al acertar.'],
        ['"Elicited imitation" es:', ['Escribir un ensayo', 'Repetir exactamente una frase oída', 'Leer en voz alta', 'Traducir'], 1, 'Escuchas y repites literal.'],
        ['En Writing conviene:', ['Escribir lo mínimo', 'Más contenido con variedad y conectores', 'Solo una frase', 'Copiar la consigna'], 1, 'Vocabulario variado y conectores suman.'],
      ],
    },
  };

  /* --------------------------------------------------------------- estado */
  const LS_EXAM = 'learn.exam';
  const LS_XP = 'learn.xp';
  const LS_STREAK = 'learn.beststreak';
  const state = {
    exam: localStorage.getItem(LS_EXAM) || 'SAT',
    mode: 'tips', // tips | cards | quiz
  };
  if (!EXAMS[state.exam]) state.exam = 'SAT';

  const getXP = () => +localStorage.getItem(LS_XP) || 0;
  const addXP = (n) => localStorage.setItem(LS_XP, getXP() + n);
  const getBest = () => +localStorage.getItem(LS_STREAK) || 0;
  const setBest = (n) => n > getBest() && localStorage.setItem(LS_STREAK, n);

  /* --------------------------------------------------------------- render */
  function render() {
    const root = $('learn-root');
    if (!root) return;
    const ex = EXAMS[state.exam];
    root.innerHTML = `
      <div class="mb-stack-md">
        <h1 class="text-2xl md:text-3xl font-semibold text-primary">Aprender · modo divertido</h1>
        <p class="text-on-surface-variant mt-1">Elige tu examen y practica con tips, tarjetas y minijuegos. XP total: <b>${getXP()}</b> ⚡ · Mejor racha: <b>${getBest()}</b> 🔥</p>
      </div>

      <div class="flex flex-wrap gap-2 mb-stack-md">
        ${Object.keys(EXAMS)
          .map(
            (k) => `<button data-exam="${k}" class="learn-exam px-3 py-2 rounded-full border text-sm transition-colors ${
              k === state.exam
                ? 'bg-primary text-white border-primary'
                : 'border-outline-variant text-on-surface-variant hover:border-primary'
            }">${EXAMS[k].icon} ${esc(EXAMS[k].name)}</button>`
          )
          .join('')}
      </div>

      <div class="${CARD} p-4 mb-stack-md">
        <p class="text-on-surface-variant text-sm">${ex.icon} <b class="text-primary">${esc(ex.name)}</b> — ${esc(ex.blurb)}</p>
      </div>

      <div class="flex gap-2 mb-stack-md">
        ${['tips', 'cards', 'quiz']
          .map((m) => {
            const label = { tips: '💡 Tips', cards: '🃏 Flashcards', quiz: '🎮 Quiz' }[m];
            return `<button data-mode="${m}" class="learn-mode flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              m === state.mode
                ? 'bg-primary text-white border-primary'
                : 'border-outline-variant text-on-surface-variant hover:border-primary'
            }">${label}</button>`;
          })
          .join('')}
      </div>

      <div id="learn-body"></div>
    `;

    root.querySelectorAll('.learn-exam').forEach((b) =>
      b.addEventListener('click', () => {
        state.exam = b.dataset.exam;
        localStorage.setItem(LS_EXAM, state.exam);
        render();
      })
    );
    root.querySelectorAll('.learn-mode').forEach((b) =>
      b.addEventListener('click', () => {
        state.mode = b.dataset.mode;
        render();
      })
    );

    if (state.mode === 'tips') renderTips();
    else if (state.mode === 'cards') renderCards();
    else renderQuiz();
  }

  function renderTips() {
    const ex = EXAMS[state.exam];
    $('learn-body').innerHTML = Object.entries(ex.tips)
      .map(
        ([cat, list]) => `
        <div class="${CARD} p-4 mb-stack-sm">
          <h3 class="font-semibold text-primary mb-2">${esc(cat)}</h3>
          <ul class="space-y-2">
            ${list
              .map(
                (t) =>
                  `<li class="text-sm text-on-surface flex gap-2"><span>✅</span><span>${esc(t)}</span></li>`
              )
              .join('')}
          </ul>
        </div>`
      )
      .join('');
  }

  function renderCards() {
    const ex = EXAMS[state.exam];
    let i = 0;
    let flipped = false;
    const body = $('learn-body');
    function paint() {
      const [front, back] = ex.flashcards[i];
      body.innerHTML = `
        <div class="${CARD} p-8 mb-4 text-center cursor-pointer select-none" id="fc-card" style="min-height:180px;display:flex;align-items:center;justify-content:center;">
          <div>
            <p class="text-xs uppercase tracking-wide text-on-surface-variant mb-3">${flipped ? 'Definición' : 'Concepto'} — toca para girar</p>
            <p class="text-lg ${flipped ? 'text-on-surface' : 'text-primary font-semibold'}">${esc(flipped ? back : front)}</p>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <button id="fc-prev" class="px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:border-primary">← Anterior</button>
          <span class="text-sm text-on-surface-variant">${i + 1} / ${ex.flashcards.length}</span>
          <button id="fc-next" class="px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:border-primary">Siguiente →</button>
        </div>`;
      $('fc-card').addEventListener('click', () => {
        flipped = !flipped;
        paint();
      });
      $('fc-prev').addEventListener('click', () => {
        i = (i - 1 + ex.flashcards.length) % ex.flashcards.length;
        flipped = false;
        paint();
      });
      $('fc-next').addEventListener('click', () => {
        i = (i + 1) % ex.flashcards.length;
        flipped = false;
        paint();
      });
    }
    paint();
  }

  function renderQuiz() {
    const ex = EXAMS[state.exam];
    let i = 0;
    let score = 0;
    let streak = 0;
    let answered = false;
    const body = $('learn-body');
    function paint() {
      if (i >= ex.quiz.length) {
        setBest(streak);
        body.innerHTML = `
          <div class="${CARD} p-8 text-center">
            <p class="text-4xl mb-3">${score === ex.quiz.length ? '🏆' : score > 0 ? '🎉' : '💪'}</p>
            <h3 class="text-xl font-semibold text-primary mb-1">${score} / ${ex.quiz.length} correctas</h3>
            <p class="text-on-surface-variant text-sm mb-4">Ganaste ${score * 10} XP ⚡</p>
            <button id="q-again" class="px-5 py-2 rounded-lg bg-primary text-white">Jugar de nuevo</button>
          </div>`;
        $('q-again').addEventListener('click', () => {
          i = 0; score = 0; streak = 0; answered = false; paint();
        });
        return;
      }
      const [q, opts, ans, why] = ex.quiz[i];
      body.innerHTML = `
        <div class="${CARD} p-5">
          <div class="flex justify-between items-center mb-3 text-sm text-on-surface-variant">
            <span>Pregunta ${i + 1} / ${ex.quiz.length}</span>
            <span>Racha: ${streak} 🔥</span>
          </div>
          <p class="text-on-surface font-medium mb-4">${esc(q)}</p>
          <div class="space-y-2" id="q-opts">
            ${opts
              .map(
                (o, k) =>
                  `<button data-k="${k}" class="q-opt w-full text-left px-4 py-3 rounded-lg border border-outline-variant hover:border-primary transition-colors">${esc(o)}</button>`
              )
              .join('')}
          </div>
          <div id="q-feedback" class="mt-4 text-sm" hidden></div>
          <button id="q-next" class="mt-4 px-5 py-2 rounded-lg bg-primary text-white" hidden>Siguiente →</button>
        </div>`;

      body.querySelectorAll('.q-opt').forEach((b) =>
        b.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const k = +b.dataset.k;
          const ok = k === ans;
          if (ok) { score++; streak++; addXP(10); } else { streak = 0; }
          setBest(streak);
          body.querySelectorAll('.q-opt').forEach((btn, idx) => {
            btn.disabled = true;
            if (idx === ans) btn.style.cssText = 'background:#dcfce7;border-color:#22c55e;color:#166534';
            else if (idx === k) btn.style.cssText = 'background:#fee2e2;border-color:#ef4444;color:#991b1b';
          });
          const fb = $('q-feedback');
          fb.hidden = false;
          fb.innerHTML = `${ok ? '✅ <b>¡Correcto!</b>' : '❌ <b>Casi.</b>'} ${esc(why)}`;
          $('q-next').hidden = false;
        })
      );
      $('q-next').addEventListener('click', () => {
        i++; answered = false; paint();
      });
    }
    paint();
  }

  /* ------------------------------------------------------- API + selfcheck */
  window.__learn = { render };

  // ponytail: chequeo mínimo de integridad de datos (índice de respuesta válido).
  // Corre solo con ?learntest en la URL; en producción no hace nada.
  if (typeof location !== 'undefined' && /[?&]learntest\b/.test(location.search)) {
    let bad = 0;
    for (const [key, ex] of Object.entries(EXAMS)) {
      ex.quiz.forEach(([, opts, ans], qi) => {
        if (!(ans >= 0 && ans < opts.length)) { bad++; console.error(`quiz ${key}#${qi}: ans fuera de rango`); }
      });
      ex.flashcards.forEach((c, ci) => {
        if (c.length !== 2) { bad++; console.error(`flashcard ${key}#${ci}: debe ser [front, back]`); }
      });
    }
    console.log(bad === 0 ? '✅ learn.js selfcheck OK' : `❌ learn.js selfcheck: ${bad} fallos`);
  }
})();
