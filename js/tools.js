/* ==========================================================================
   tools.js — Herramientas de la interfaz del examen (estilo Bluebook):
     · Calculadora Desmos embebida en panel flotante y arrastrable
     · Hoja de referencia con las fórmulas oficiales del SAT
     · Menú "More" (salir del examen, cronómetro, atajos)
     · Highlights & Notes: resaltar y anotar texto seleccionado
   ========================================================================== */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const toast = (m, ms) => (window.__toast ? window.__toast(m, ms) : void 0);

  /* ---------------- Utilidad: hacer un panel arrastrable ---------------- */
  function makeDraggable(panel, handle) {
    let sx, sy, ox, oy, dragging = false;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.bb-panel-close')) return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      sx = e.clientX;
      sy = e.clientY;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = ox + 'px';
      panel.style.top = oy + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      let nx = ox + (e.clientX - sx);
      let ny = oy + (e.clientY - sy);
      nx = Math.max(0, Math.min(window.innerWidth - 60, nx));
      ny = Math.max(0, Math.min(window.innerHeight - 40, ny));
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
    });
    window.addEventListener('mouseup', () => (dragging = false));
  }

  function buildPanel(id, title) {
    let panel = $(id);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = id;
    panel.className = 'bb-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="bb-panel-head">
        <span class="bb-panel-title">${title}</span>
        <button class="bb-panel-close" title="Cerrar">&times;</button>
      </div>
      <div class="bb-panel-body"></div>`;
    document.body.appendChild(panel);
    panel.querySelector('.bb-panel-close').addEventListener('click', () => (panel.hidden = true));
    makeDraggable(panel, panel.querySelector('.bb-panel-head'));
    return panel;
  }

  /* ---------------- Calculadora Desmos ---------------- */
  const DESMOS_KEY = 'dcb31709b452b1cf9dc26972add0fda6'; // clave pública de demo de Desmos
  let desmosLoading = false;
  const desmosQueue = [];
  let calcInstance = null;

  function loadDesmos(cb) {
    if (window.Desmos) return cb();
    desmosQueue.push(cb);
    if (desmosLoading) return;
    desmosLoading = true;
    const s = document.createElement('script');
    s.src = `https://www.desmos.com/api/v1.10/calculator.js?apiKey=${DESMOS_KEY}`;
    s.onload = () => desmosQueue.splice(0).forEach((f) => f());
    s.onerror = () => {
      desmosLoading = false;
      toast('No se pudo cargar la calculadora. Revisa tu conexión.');
    };
    document.head.appendChild(s);
  }

  function toggleCalculator() {
    const panel = buildPanel('bb-calc-panel', 'Calculadora');
    if (!panel.hidden) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    panel.classList.add('bb-panel-calc');
    const body = panel.querySelector('.bb-panel-body');
    if (!calcInstance) {
      body.innerHTML = '<div class="bb-panel-loading">Cargando calculadora Desmos…</div>';
      loadDesmos(() => {
        body.innerHTML = '';
        const el = document.createElement('div');
        el.className = 'bb-calc-graph';
        body.appendChild(el);
        try {
          calcInstance = window.Desmos.GraphingCalculator(el, {
            expressions: true,
            settingsMenu: false,
            border: false,
          });
        } catch (e) {
          body.innerHTML = '<div class="bb-panel-loading">No se pudo iniciar la calculadora.</div>';
        }
      });
    }
  }

  /* ---------------- Hoja de referencia (fórmulas SAT) ---------------- */
  function referenceHTML() {
    return `
      <div class="bb-ref">
        <p class="bb-ref-intro">Información que puedes usar en la sección de Math:</p>
        <div class="bb-ref-grid">
          <figure><div class="bb-ref-fig">◯</div><figcaption>A = πr²<br>C = 2πr</figcaption></figure>
          <figure><div class="bb-ref-fig">▭</div><figcaption>A = ℓw</figcaption></figure>
          <figure><div class="bb-ref-fig">◺</div><figcaption>A = ½bh</figcaption></figure>
          <figure><div class="bb-ref-fig">◿</div><figcaption>c² = a² + b²</figcaption></figure>
          <figure><div class="bb-ref-fig">30°–60°–90°</div><figcaption>lados: x, x√3, 2x</figcaption></figure>
          <figure><div class="bb-ref-fig">45°–45°–90°</div><figcaption>lados: s, s, s√2</figcaption></figure>
          <figure><div class="bb-ref-fig">▬</div><figcaption>V = ℓwh</figcaption></figure>
          <figure><div class="bb-ref-fig">⬛</div><figcaption>V = πr²h (cilindro)</figcaption></figure>
          <figure><div class="bb-ref-fig">⚪</div><figcaption>V = 4⁄3 πr³ (esfera)</figcaption></figure>
          <figure><div class="bb-ref-fig">△</div><figcaption>V = 1⁄3 πr²h (cono)</figcaption></figure>
          <figure><div class="bb-ref-fig">◇</div><figcaption>V = 1⁄3 ℓwh (pirámide)</figcaption></figure>
        </div>
        <ul class="bb-ref-facts">
          <li>El número de grados de arco en un círculo es 360.</li>
          <li>El número de radianes de arco en un círculo es 2π.</li>
          <li>La suma de las medidas en grados de los ángulos de un triángulo es 180.</li>
        </ul>
      </div>`;
  }

  function toggleReference() {
    const panel = buildPanel('bb-ref-panel', 'Hoja de referencia');
    if (!panel.hidden) {
      panel.hidden = true;
      return;
    }
    const body = panel.querySelector('.bb-panel-body');
    if (!body.dataset.ready) {
      body.innerHTML = referenceHTML();
      body.dataset.ready = '1';
    }
    panel.hidden = false;
  }

  /* ---------------- Menú "More" ---------------- */
  function buildMoreMenu() {
    let menu = $('bb-more-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'bb-more-menu';
    menu.className = 'bb-more-menu';
    menu.hidden = true;
    menu.innerHTML = `
      <button data-act="timer"><span class="material-symbols-outlined">timer</span>Mostrar / ocultar cronómetro</button>
      <button data-act="shortcuts"><span class="material-symbols-outlined">keyboard</span>Atajos de teclado</button>
      <button data-act="exit"><span class="material-symbols-outlined">logout</span>Salir del examen</button>`;
    document.body.appendChild(menu);

    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      menu.hidden = true;
      if (b.dataset.act === 'timer') {
        const t = $('btn-timer-toggle');
        if (t) t.click();
      } else if (b.dataset.act === 'shortcuts') {
        toast('Atajos: ← / → cambian de pregunta · M marca para revisión.', 4200);
      } else if (b.dataset.act === 'exit') {
        if (confirm('¿Salir del examen? Volverás al panel y este intento no se guardará.')) {
          if (window.__stopProctor) window.__stopProctor(); // apaga la cámara de inmediato
          if (window.__portal && window.__portal.goView) window.__portal.goView('dashboard');
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !e.target.closest('#bb-more-menu') && !e.target.closest('#btn-more')) {
        menu.hidden = true;
      }
    });
    return menu;
  }

  function toggleMore() {
    const menu = buildMoreMenu();
    if (!menu.hidden) {
      menu.hidden = true;
      return;
    }
    const btn = $('btn-more');
    const r = btn.getBoundingClientRect();
    // Se muestra primero para poder medir su ancho y luego acotarlo a la pantalla
    // (en móvil el botón puede quedar a la izquierda y el menú se salía del borde).
    menu.style.right = 'auto';
    menu.hidden = false;
    const mw = menu.offsetWidth || 240;
    let left = r.right - mw; // alinea el borde derecho del menú con el del botón
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    menu.style.left = left + 'px';
    menu.style.top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8) + 'px';
  }

  /* ---------------- Highlights & Notes ---------------- */
  let selPopover = null;
  let annotateHint = false;

  function getPopover() {
    if (selPopover) return selPopover;
    selPopover = document.createElement('div');
    selPopover.className = 'bb-sel-popover';
    selPopover.hidden = true;
    selPopover.innerHTML = `
      <button data-sel="hl"><span class="material-symbols-outlined">ink_highlighter</span>Resaltar</button>
      <button data-sel="note"><span class="material-symbols-outlined">sticky_note_2</span>Nota</button>`;
    document.body.appendChild(selPopover);
    selPopover.addEventListener('mousedown', (e) => e.preventDefault()); // no perder la selección
    selPopover.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      applyHighlight(b.dataset.sel === 'note');
      selPopover.hidden = true;
    });
    return selPopover;
  }

  function withinAnnotatable(node) {
    return (
      $('passage-content') && ($('passage-content').contains(node) || $('question-content').contains(node))
    );
  }

  function onSelection() {
    const sel = window.getSelection();
    const pop = getPopover();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      pop.hidden = true;
      return;
    }
    const range = sel.getRangeAt(0);
    if (!withinAnnotatable(range.commonAncestorContainer)) {
      pop.hidden = true;
      return;
    }
    const r = range.getBoundingClientRect();
    pop.hidden = false;
    const pw = pop.offsetWidth || 160;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8)); // no salir de pantalla
    pop.style.left = window.scrollX + left + 'px';
    pop.style.top = window.scrollY + Math.max(8, r.top - 44) + 'px';
  }

  function applyHighlight(withNote) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!withinAnnotatable(range.commonAncestorContainer)) return;
    let note = '';
    if (withNote) {
      note = prompt('Escribe tu nota para este texto:') || '';
    }
    try {
      const span = document.createElement('span');
      span.className = 'hl' + (note ? ' hl-note' : '');
      if (note) span.title = note;
      range.surroundContents(span);
      sel.removeAllRanges();
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        onHighlightClick(span);
      });
    } catch (_) {
      toast('No se pudo resaltar (la selección cruza varios elementos).');
    }
  }

  function onHighlightClick(span) {
    const hasNote = span.classList.contains('hl-note');
    const msg = hasNote ? `Nota: ${span.title}\n\n¿Qué quieres hacer?` : '¿Quitar el resaltado?';
    if (hasNote) {
      const action = prompt(msg + '\n\nEscribe: editar / quitar (o cancela)', 'editar');
      if (action === 'quitar') unwrap(span);
      else if (action === 'editar') {
        const nn = prompt('Edita tu nota:', span.title);
        if (nn !== null) {
          span.title = nn;
          if (!nn) {
            span.classList.remove('hl-note');
          }
        }
      }
    } else {
      if (confirm('¿Quitar el resaltado?')) unwrap(span);
    }
  }

  function unwrap(span) {
    const parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  }

  function toggleAnnotateHint() {
    annotateHint = !annotateHint;
    const btn = $('btn-annotate');
    if (btn) btn.classList.toggle('active', annotateHint);
    toast(
      annotateHint
        ? 'Selecciona texto del pasaje o la pregunta para resaltarlo o añadir una nota.'
        : 'Modo resaltar desactivado.',
      3200
    );
  }

  /* ---------------- Enganches ---------------- */
  function bind() {
    const calc = $('btn-calc');
    const ref = $('btn-ref');
    const more = $('btn-more');
    const ann = $('btn-annotate');
    if (calc) calc.addEventListener('click', toggleCalculator);
    if (ref) ref.addEventListener('click', toggleReference);
    if (more) more.addEventListener('click', toggleMore);
    if (ann) ann.addEventListener('click', toggleAnnotateHint);

    document.addEventListener('mouseup', () => setTimeout(onSelection, 0));
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        if (selPopover) selPopover.hidden = true;
      }
    });

    // Atajos de teclado tipo Bluebook (solo en la pantalla de test)
    document.addEventListener('keydown', (e) => {
      const testActive = $('screen-test') && $('screen-test').classList.contains('active');
      if (!testActive) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowRight') {
        const n = $('btn-next');
        if (n) n.click();
      } else if (e.key === 'ArrowLeft') {
        const b = $('btn-back');
        if (b && !b.disabled) b.click();
      } else if (e.key === 'm' || e.key === 'M') {
        const mk = $('btn-mark');
        if (mk) mk.click();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
