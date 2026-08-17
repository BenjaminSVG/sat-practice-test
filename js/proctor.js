/* ==========================================================================
   proctor.js — Monitoreo por cámara: detecta giros de cabeza (costado / arriba
   / abajo) y la presencia de más de una persona frente a la cámara.
   Usa MediaPipe Face Landmarker (on-device, vía CDN). El video jamás sale del
   navegador: solo se descarga el modelo de detección (pesos de la red), no se
   sube ningún fotograma a ningún servidor.

   Calibración: antes de cada examen monitoreado, el sistema pide al alumno
   mirar de frente a la cámara un par de segundos y usa esa postura como línea
   base ("cero" de yaw/pitch). Así el umbral de alerta es relativo a la postura
   natural de cada persona y de su cámara (posición, ángulo de pantalla), en
   vez de un ángulo absoluto fijo — reduce falsas alarmas y detecciones
   perdidas por diferencias de setup entre alumnos.
   ========================================================================== */

(function () {
  'use strict';

  const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';
  const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
  const MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  // Umbrales de ángulo (radianes, relativos a la línea base calibrada) y
  // tiempos de sostenimiento/cooldown.
  const YAW_LIMIT = 0.35; // ~20° — girar la cabeza hacia un costado
  const PITCH_UP_LIMIT = 0.30; // ~17° — inclinar la cabeza hacia arriba
  const PITCH_DOWN_LIMIT = 0.32; // ~18° — inclinar hacia abajo (teléfono/notas en el regazo)
  const SUSTAIN_MS = 800; // el gesto debe mantenerse este tiempo para contar como alerta
  const NO_FACE_SUSTAIN_MS = 2500; // tiempo sin detectar rostro para alertar
  const ALERT_COOLDOWN_MS = 4000; // tiempo mínimo entre alertas del mismo tipo
  const DETECT_INTERVAL_MS = 200;
  const EMA_ALPHA = 0.35; // suavizado exponencial del ángulo (reduce ruido/jitter de frame a frame)

  const CALIBRATION_MS = 2200;
  const CALIBRATION_MIN_SAMPLES = 5;

  let landmarker = null;
  let stream = null;
  let videoEl = null;
  let loopHandle = null;
  let running = false;
  let stopRequested = false;
  let onAlert = function () {};
  let onStatus = function () {};

  const baseline = { yaw: 0, pitch: 0 };
  const ema = { yaw: null, pitch: null };
  const gestureStart = { side: null, up: null, down: null, multiface: null };
  let noFaceStart = null;
  const lastAlertAt = { side: 0, up: 0, down: 0, multiface: 0, noface: 0 };

  async function ensureLandmarker() {
    if (landmarker) return landmarker;
    const vision = await import(TASKS_VISION_URL);
    const { FaceLandmarker, FilesetResolver } = vision;
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_URL);
    const baseOpts = {
      runningMode: 'VIDEO',
      numFaces: 2, // detecta hasta 2 rostros para poder alertar si aparece una segunda persona
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    };
    try {
      landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        ...baseOpts,
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      });
    } catch (_) {
      landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        ...baseOpts,
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      });
    }
    return landmarker;
  }

  function resetGestureState() {
    gestureStart.side = null;
    gestureStart.up = null;
    gestureStart.down = null;
    gestureStart.multiface = null;
    noFaceStart = null;
    ema.yaw = null;
    ema.pitch = null;
  }

  function median(nums) {
    if (!nums.length) return 0;
    const s = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Une un solo rostro con su ángulo yaw/pitch, o null si no hay exactamente uno.
  function sampleSingleFace() {
    const now = performance.now();
    let result;
    try {
      result = landmarker.detectForVideo(videoEl, now);
    } catch (_) {
      return null;
    }
    const faces = result && result.facialTransformationMatrixes;
    if (!faces || faces.length !== 1) return null;
    const m = faces[0].data;
    return { yaw: Math.atan2(m[8], m[10]), pitch: Math.atan2(m[9], m[10]) };
  }

  // Fase de calibración: pide al alumno mirar de frente y promedia su postura
  // "neutral" para usarla como línea base del resto del examen.
  async function calibrate() {
    onStatus('calibrating', 'Calibrando… mira directo a la cámara');
    const samples = [];
    const deadline = performance.now() + CALIBRATION_MS;
    while (performance.now() < deadline) {
      if (stopRequested) return;
      const s = sampleSingleFace();
      if (s) samples.push(s);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, DETECT_INTERVAL_MS));
    }
    if (stopRequested) return;
    if (samples.length >= CALIBRATION_MIN_SAMPLES) {
      baseline.yaw = median(samples.map((s) => s.yaw));
      baseline.pitch = median(samples.map((s) => s.pitch));
    } else {
      baseline.yaw = 0;
      baseline.pitch = 0;
      onStatus('loading', 'No se detectó tu rostro durante la calibración; usando valores por defecto');
      await new Promise((r) => setTimeout(r, 900));
    }
  }

  async function start(opts) {
    if (running) return;
    opts = opts || {};
    onAlert = opts.onAlert || function () {};
    onStatus = opts.onStatus || function () {};
    videoEl = opts.videoEl;
    stopRequested = false;

    onStatus('loading', 'Cargando detector de rostro…');
    await ensureLandmarker();
    if (stopRequested) return;

    onStatus('loading', 'Solicitando acceso a la cámara…');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 },
      audio: false,
    });
    if (stopRequested) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      return;
    }
    videoEl.srcObject = stream;
    await videoEl.play();

    resetGestureState();
    await calibrate();
    if (stopRequested) return;

    running = true;
    onStatus('ok', 'Calibración lista — monitoreo activo');
    loopHandle = setInterval(detectTick, DETECT_INTERVAL_MS);
  }

  function detectTick() {
    if (!running || !landmarker || !videoEl || videoEl.readyState < 2) return;
    const now = performance.now();
    let result;
    try {
      result = landmarker.detectForVideo(videoEl, now);
    } catch (_) {
      return;
    }
    const faces = result && result.facialTransformationMatrixes;
    if (!faces || !faces.length) {
      gestureStart.multiface = null;
      handleNoFace(now);
      return;
    }
    noFaceStart = null;

    checkGesture(
      'multiface',
      faces.length > 1,
      now,
      'Se detectó más de una persona frente a la cámara'
    );

    // Matriz 4x4 column-major; la 3ª columna (índices 8,9,10) es el eje "hacia
    // afuera de la cara" en coordenadas de cámara. Su proyección da el ángulo
    // de giro (yaw) e inclinación (pitch) de la cabeza sin ambigüedad de orden.
    const m = faces[0].data;
    const rawYaw = Math.atan2(m[8], m[10]) - baseline.yaw;
    const rawPitch = Math.atan2(m[9], m[10]) - baseline.pitch;

    // Suavizado exponencial: reduce falsas alertas por ruido de un solo frame.
    ema.yaw = ema.yaw == null ? rawYaw : ema.yaw + EMA_ALPHA * (rawYaw - ema.yaw);
    ema.pitch = ema.pitch == null ? rawPitch : ema.pitch + EMA_ALPHA * (rawPitch - ema.pitch);

    checkGesture('side', Math.abs(ema.yaw) > YAW_LIMIT, now, 'Movimiento sospechoso: mirando hacia un costado');
    checkGesture('up', ema.pitch > PITCH_UP_LIMIT, now, 'Movimiento sospechoso: mirando hacia arriba');
    checkGesture(
      'down',
      ema.pitch < -PITCH_DOWN_LIMIT,
      now,
      'Movimiento sospechoso: mirando hacia abajo (posible teléfono o notas)'
    );
  }

  function handleNoFace(now) {
    gestureStart.side = null;
    gestureStart.up = null;
    gestureStart.down = null;
    ema.yaw = null;
    ema.pitch = null;
    if (noFaceStart == null) noFaceStart = now;
    if (now - noFaceStart >= NO_FACE_SUSTAIN_MS) {
      fireAlert('noface', now, 'No se detecta tu rostro frente a la cámara');
      noFaceStart = now;
    }
  }

  function checkGesture(key, active, now, message) {
    if (!active) {
      gestureStart[key] = null;
      return;
    }
    if (gestureStart[key] == null) gestureStart[key] = now;
    if (now - gestureStart[key] >= SUSTAIN_MS) {
      fireAlert(key, now, message);
      gestureStart[key] = now; // exige volver a sostener el gesto tras disparar
    }
  }

  function fireAlert(key, now, message) {
    if (now - (lastAlertAt[key] || 0) < ALERT_COOLDOWN_MS) return;
    lastAlertAt[key] = now;
    onAlert({ type: key, message, time: Date.now() });
  }

  function stop() {
    stopRequested = true;
    running = false;
    if (loopHandle) clearInterval(loopHandle);
    loopHandle = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
    resetGestureState();
  }

  window.SATProctor = { start, stop };
})();
