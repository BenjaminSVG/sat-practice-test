/* ==========================================================================
   pdf-parser.js
   Lee un PDF exportado desde el SAT Suite Question Bank del College Board
   y lo convierte en una lista estructurada de preguntas.

   Formato real de cada pregunta (una por página de inicio):
     Question ID: <id>
     Assessment  Test  Domain  Skill  Difficulty
     SAT  <Math|Reading and Writing>  <domain...>  <skill...>  <Easy|Medium|Hard>
     (posibles líneas de metadatos envueltas)
     Question
     <enunciado / pasaje ...>
     Answer                (solo en opción múltiple)
     A. <opción>   B. ...  C. ...  D. ...
     Correct Answer: <letra o valor>
     Rationale
     <explicación ...>

   Particularidades:
   - El export inserta un espacio espurio dentro de muchos items
     ("repor ted"→"reported"); se corrige colapsando espacios internos.
   - En Math las opciones y varios números/figuras son IMÁGENES: el texto
     sale vacío. Para esas preguntas se guarda la geometría y se renderiza la
     región del PDF como imagen (needsImage = true).
   ========================================================================== */

(function (global) {
  'use strict';

  // PDF.js se carga BAJO DEMANDA (solo al importar un PDF), para no descargar
  // ~300KB en cada visita al dashboard/login que no importa nada.
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  let _pdfjsReady = null;

  function ensurePdfjs() {
    if (global.pdfjsLib) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return Promise.resolve(global.pdfjsLib);
    }
    if (_pdfjsReady) return _pdfjsReady;
    _pdfjsReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => {
        if (!global.pdfjsLib) return reject(new Error('No se pudo inicializar el lector de PDF.'));
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(global.pdfjsLib);
      };
      s.onerror = () => reject(new Error('No se pudo cargar el lector de PDF (revisa tu conexión).'));
      document.head.appendChild(s);
    });
    return _pdfjsReady;
  }

  const _docs = {};         // srcId -> documento PDF.js cargado (varios a la vez)
  let _docCounter = 0;
  const _pageHeights = {};  // alto en puntos por página

  function cleanStr(s) {
    // Colapsa el espacio espurio interno de un item (los espacios reales
    // entre palabras llegan como items " " independientes).
    return s.replace(/([A-Za-zÀ-ÿ])\s(?=[A-Za-zÀ-ÿ])/g, '$1');
  }

  /* ---------- Extrae páginas con líneas y su coordenada Y ---------- */
  async function extractPages(pdf) {
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      _pageHeights[p] = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();

      const rows = {};
      content.items.forEach((it) => {
        if (!it.str) return;
        const y = Math.round(it.transform[5]);
        (rows[y] = rows[y] || []).push({ x: it.transform[4], s: cleanStr(it.str) });
      });

      const lines = Object.keys(rows)
        .map(Number)
        .sort((a, b) => b - a)
        .map((y) => ({
          y,
          text: rows[y]
            .sort((a, b) => a.x - b.x)
            .map((t) => t.s)
            .join('')
            .replace(/\s+/g, ' ')
            .trim(),
        }))
        .filter((l) => l.text.length && !isNoise(l.text));

      pages.push({ page: p, lines });
    }
    return pages;
  }

  function isNoise(t) {
    if (/^©?\s*\d{0,4}\s*College Board/i.test(t)) return false; // se conserva por si acaso
    if (/^Page\s+\d+/i.test(t)) return true;
    if (/^\d+\s*(of|\/)\s*\d+$/i.test(t)) return true;
    return false;
  }

  const HEADER_WORDS = /^(Assessment|Test|Domain|Skill|Difficulty)$/i;
  const CHOICE_RE = /^\s*([A-D])[\.\)]\s*(.*)$/; // acepta opción vacía ("A.")

  // Detecta el dominio del contenido por palabras clave (los 4 dominios oficiales
  // de cada sección del SAT digital).
  function detectDomain(section, text) {
    if (section === 'math') {
      if (/Advanced Math/i.test(text)) return 'Advanced Math';
      if (/Problem-?Solving|Data Analysis/i.test(text)) return 'Problem-Solving and Data Analysis';
      if (/Geometry|Trigonometry/i.test(text)) return 'Geometry and Trigonometry';
      if (/Algebra/i.test(text)) return 'Algebra';
      return 'Otro';
    }
    if (/Information and Ideas/i.test(text)) return 'Information and Ideas';
    if (/Craft and Structure/i.test(text)) return 'Craft and Structure';
    if (/Expression of Ideas/i.test(text)) return 'Expression of Ideas';
    if (/Standard English Conventions/i.test(text)) return 'Standard English Conventions';
    return 'Otro';
  }

  /* ---------- Parsea las líneas de un bloque (una pregunta) ---------- */
  function parseBlockLines(blockLines, index) {
    const lines = blockLines.map((l) => l.text);

    const q = {
      id: 'Q' + (index + 1),
      section: null,
      domain: '',
      skill: '',
      difficulty: '',
      stem: '',
      choices: [],
      correct: '',
      rationale: '',
      isSPR: false,
      needsImage: false,
      page: blockLines[0] ? blockLines[0]._page : 1,
      geom: null,
    };

    // ID
    const idLine = lines.find((l) => /^Question ID/i.test(l));
    if (idLine) q.id = idLine.replace(/^Question ID:?\s*/i, '').trim() || q.id;

    // Clasificación
    const clsLine = lines.find((l) => /^SAT\b/i.test(l) && /(Reading and Writing|Math)/i.test(l));
    if (clsLine) {
      q.section = /Reading and Writing/i.test(clsLine) ? 'rw' : 'math';
      const dm = clsLine.match(/(Easy|Medium|Hard)\s*$/i);
      if (dm) q.difficulty = dm[1];
    }
    if (!q.section) {
      const joined = lines.join(' ');
      q.section = /Reading and Writing/i.test(joined) ? 'rw' : /\bMath\b/i.test(joined) ? 'math' : 'rw';
    }

    // Dominio (mejor esfuerzo por palabras clave; la clasificación puede venir
    // envuelta en varias líneas, así que buscamos en todo el bloque).
    q.domain = detectDomain(q.section, lines.join(' '));

    // El enunciado real empieza tras el encabezado "Question".
    const hasQHeader = lines.some((l) => /^Question$/i.test(l));
    let started = !hasQHeader; // si no hay encabezado, empezamos desde el inicio
    const bodyLines = [];
    let mode = 'stem';
    let curChoice = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^Question ID/i.test(line)) continue;
      if (HEADER_WORDS.test(line)) continue;
      if (line === clsLine) continue;
      if (/^ID:\s*\S+\s*$/i.test(line)) continue;
      if (/^Assessment\b/i.test(line) && /Difficulty/i.test(line)) continue;
      if (/^Question Difficulty:/i.test(line)) continue;

      // Encabezado "Question": marca el inicio del enunciado
      if (/^Question$/i.test(line)) { started = true; mode = 'stem'; continue; }
      if (!started) continue; // ignora metadatos envueltos previos al enunciado

      // Encabezado "Answer": separa enunciado de opciones
      if (/^Answer$/i.test(line)) { mode = 'stem'; curChoice = null; continue; }

      const cm = line.match(/^Correct Answer:\s*(.*)$/i);
      if (cm) { q.correct = cm[1].trim(); curChoice = null; mode = 'rationale'; continue; }

      if (/^Rationale\b/i.test(line)) {
        mode = 'rationale'; curChoice = null;
        const rest = line.replace(/^Rationale[:]?\s*/i, '').trim();
        if (rest) q.rationale += rest + ' ';
        continue;
      }

      const chm = line.match(CHOICE_RE);
      if (chm && mode !== 'rationale') {
        mode = 'choices';
        curChoice = { letter: chm[1].toUpperCase(), text: chm[2].trim() };
        q.choices.push(curChoice);
        continue;
      }

      if (mode === 'rationale') q.rationale += line + ' ';
      else if (mode === 'choices' && curChoice) curChoice.text += ' ' + line;
      else bodyLines.push(line);
    }

    q.stem = bodyLines.join('\n').trim();
    q.rationale = q.rationale.replace(/\s+/g, ' ').trim();
    q.choices.forEach((c) => (c.text = c.text.replace(/\s+/g, ' ').trim()));
    q.correct = q.correct.replace(/\s+/g, ' ').trim();

    // Elimina opciones duplicadas por letra (conserva la primera)
    const seen = {};
    q.choices = q.choices.filter((c) => (seen[c.letter] ? false : (seen[c.letter] = true)));

    // ¿Respuesta libre?  Sin opciones y respuesta no-letra.
    q.isSPR = q.choices.length === 0;
    q.type = q.isSPR ? 'spr' : 'mcq'; // grid-in vs opción múltiple

    // ¿Necesita renderizarse como imagen?
    // - Math: siempre (fórmulas, formas geométricas, tablas y números son gráficos).
    // - R&W: si hay señales de figura embebida (tabla o gráfico). Se decide con
    //   tres señales; aquí van dos (texto). La tercera (hueco vertical en el PDF)
    //   se evalúa en computeGeom, que tiene las coordenadas.
    const emptyChoice = q.choices.some((c) => !c.text);
    // Frases que en R&W anuncian una tabla o un gráfico embebido.
    const figPhrase =
      /\b(based on (the |data in the )?(table|graph|figure|chart|data)|data (from|in|shown in) the (table|graph|figure|chart)|uses data from|complete the (statement|table)|the (following|accompanying|data in the) (table|graph|figure|chart)|the (table|graph|figure|chart) (above|below|shown|presents|shows|indicates|displays|illustrates)|as shown in the (figure|graph|table)|according to the (table|graph|data)|(bar|line|dot) (graph|plot)|scatter\s?plot|number line)\b/i;
    q._rwFigure = q.section === 'rw' && (emptyChoice || figPhrase.test(q.stem));
    q.needsImage = q.section === 'math' || q._rwFigure;

    return q;
  }

  /* ---------- Calcula la geometría de recorte de una pregunta ---------- */
  function computeGeom(blockLines, q) {
    const startPage = blockLines[0]._page;
    // Solo consideramos las líneas de la página de inicio para el recorte.
    const pageLines = blockLines.filter((l) => l._page === startPage);

    const find = (re) => pageLines.find((l) => re.test(l.text));
    const qHeader = find(/^Question$/i);
    const answerHdr = find(/^Answer$/i);
    const correct = find(/^Correct Answer:/i);

    // Inicio del recorte: JUSTO en el encabezado "Question".
    // Importante: empezamos en el encabezado (y no en la primera línea de
    // texto) porque las figuras/formas geométricas son gráficos vectoriales
    // que NO generan líneas de texto; si empezáramos más abajo se cortarían.
    let stemTopY = null;
    if (qHeader) {
      stemTopY = qHeader.y; // el contenido (figura incluida) queda por debajo
    } else if (pageLines[1]) {
      stemTopY = pageLines[1].y + 12;
    }
    if (stemTopY == null) stemTopY = 700;

    const choiceYs = {};
    pageLines.forEach((l) => {
      const m = l.text.match(/^([A-D])[\.\)]/);
      if (m && !(m[1] in choiceYs)) choiceYs[m[1]] = l.y;
    });

    const correctY = correct ? correct.y : 40;
    // Límite inferior del recorte: MUY por encima de "Correct Answer" para no
    // revelar la respuesta ni el rationale en la imagen.
    const cropBottom = correctY + 16;

    // 3ª señal (geometría): en R&W, un HUECO vertical grande sin texto entre el
    // encabezado "Question" y las opciones indica una figura embebida (tabla o
    // gráfico como imagen, que no genera líneas de texto). Es la señal más fiable.
    if (q.section === 'rw' && !q.needsImage) {
      const choiceTop = answerHdr
        ? answerHdr.y
        : Object.keys(choiceYs).length
        ? Math.max.apply(null, Object.values(choiceYs))
        : correctY;
      const topBound = qHeader ? qHeader.y : pageLines[0] ? pageLines[0].y : Infinity;
      const region = pageLines
        .map((l) => l.y)
        .filter((y) => y < topBound && y > choiceTop)
        .sort((a, b) => b - a); // de arriba hacia abajo
      let maxGap = 0;
      for (let i = 1; i < region.length; i++) {
        const g = region[i - 1] - region[i];
        if (g > maxGap) maxGap = g;
      }
      // ~72 pts ≈ varias líneas en blanco: espacio ocupado por una figura.
      if (maxGap >= 72) {
        q.needsImage = true;
        q._rwFigure = true;
      }
    }

    // Para figuras de R&W recortamos la imagen SOLO hasta antes de las opciones:
    // las opciones se muestran como texto clicable debajo (así no se cortan ni se
    // duplican con los botones de letra). Para Math se mantiene el recorte completo.
    const beforeChoicesY = answerHdr
      ? answerHdr.y
      : Object.keys(choiceYs).length
      ? Math.max.apply(null, Object.values(choiceYs))
      : correctY;
    const figureBottom = beforeChoicesY + 6;

    q.geom = {
      page: startPage,
      pageHeight: _pageHeights[startPage] || 792,
      stemTopY,
      answerY: answerHdr ? answerHdr.y : null,
      choiceYs,
      correctY,
      cropBottom,
      figureBottom,
    };
    q.page = startPage;
  }

  /* ---------- Renderiza una región vertical de una página como dataURL ----------
     Incluye un watchdog: si el render no termina (entornos sin canvas), se
     cancela y se rechaza para poder caer al texto extraído. `srcId` identifica
     de qué PDF cargado se trata (pueden coexistir varios en memoria).           */
  async function renderRegion(srcId, pageNum, yTopPts, yBottomPts, scale = 2) {
    const doc = _docs[srcId];
    if (!doc) return null;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const full = document.createElement('canvas');
    full.width = Math.ceil(viewport.width);
    full.height = Math.ceil(viewport.height);

    const task = page.render({ canvasContext: full.getContext('2d'), viewport });
    let timer;
    const watchdog = new Promise((_, rej) => {
      timer = setTimeout(() => {
        try { task.cancel(); } catch (_) {}
        rej(new Error('render-timeout'));
      }, 12000);
    });
    try {
      await Promise.race([task.promise, watchdog]);
    } finally {
      clearTimeout(timer);
    }

    const H = viewport.height;
    // y en puntos → pixeles desde arriba
    let top = Math.max(0, (page.getViewport({ scale: 1 }).height - yTopPts) * scale - 6);
    let bottom = Math.min(H, (page.getViewport({ scale: 1 }).height - yBottomPts) * scale + 6);
    if (bottom - top < 10) bottom = Math.min(H, top + 40);

    const crop = document.createElement('canvas');
    crop.width = full.width;
    crop.height = Math.ceil(bottom - top);
    crop.getContext('2d').drawImage(full, 0, top, full.width, crop.height, 0, 0, full.width, crop.height);
    return crop.toDataURL('image/png');
  }

  /* ---------- Separa enunciado en (pasaje, pregunta) para R&W ---------- */
  const STRONG_TRIGGERS = [
    /Which choice\b[^?]*\?/i,
    /Which finding\b[^?]*\?/i,
    /Which quotation\b[^?]*\?/i,
    /Which statement\b[^?]*\?/i,
    /Based on the (text|passage|table|graph|data)\b[^?]*\?/i,
    /According to the (text|passage)\b[^?]*\?/i,
    /As used in the text[^?]*\?/i,
    /What (is|does|choice)\b[^?]*\?/i,
    /The student (wants|would|claims)\b[^?]*\?/i,
  ];

  function splitStem(stem) {
    if (!stem) return { passage: '', question: '' };
    let cut = -1;
    for (const re of STRONG_TRIGGERS) {
      const m = stem.match(re);
      if (m && (cut < 0 || m.index < cut)) cut = m.index;
    }
    if (cut < 0) {
      const qIdx = stem.lastIndexOf('?');
      if (qIdx > 0) {
        const before = stem.slice(0, qIdx);
        const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('\n'), before.lastIndexOf('! '));
        if (start > 0) cut = start + 1;
      }
    }
    if (cut > 40) return { passage: stem.slice(0, cut).trim(), question: stem.slice(cut).trim() };
    return { passage: '', question: stem.trim() };
  }

  /* ---------- API pública ---------- */
  async function parsePDF(arrayBuffer, fileName) {
    await ensurePdfjs(); // carga PDF.js si aún no está
    const srcId = 'doc' + ++_docCounter;
    const pdf = await global.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    _docs[srcId] = pdf;
    const pages = await extractPages(pdf);

    // Aplana todas las líneas, anotando su página, y divide por "Question ID".
    const all = [];
    pages.forEach((pg) => pg.lines.forEach((l) => all.push({ y: l.y, text: l.text, _page: pg.page })));

    const blocks = [];
    let cur = null;
    all.forEach((l) => {
      if (/^Question ID/i.test(l.text)) {
        cur = [];
        blocks.push(cur);
      }
      if (cur) cur.push(l);
    });
    if (!blocks.length) blocks.push(all); // sin marcadores

    const questions = blocks
      .map((bl, i) => {
        const q = parseBlockLines(bl, i);
        computeGeom(bl, q);
        q.srcId = srcId;
        q.srcFile = fileName || '';
        return q;
      })
      .filter((q) => (q.stem && q.stem.length > 3) || q.needsImage || q.choices.length);

    return questions;
  }

  global.SATParser = {
    parsePDF,
    splitStem,
    renderRegion,
    getPdf: (srcId) => _docs[srcId],
  };
})(window);
