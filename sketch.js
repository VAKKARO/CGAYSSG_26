/**
 * Arte Cinético y Lumínico - Inspirado en Gyula Kosice
 * Fase 5.00: Control por Micrófono y Análisis de Frecuencias
 */

const MADI_COLORS = [
  '#FF0055', // Rosa Neón
  '#7000FF', // Violeta Profundo
  '#FFCC00', // Amarillo Eléctrico
  '#FFFFFF', // Blanco puro
  '#00A8FF'  // Celeste Neón
];

let blocks = [];
let globalLengthMod = 1.0; 
let bubbleMoveUntil = 0;

// Variables globales para las imágenes pre-cargadas
let bubbleImages = [];
let cylinderImages = {
  corto: { claro: null, oscuro: null },
  mediano: { claro: null, oscuro: null },
  largo: { claro: null, oscuro: null }
};


// Variables globales para el análisis de sonido (Web Audio API)
let audioCtx = null;
let analyser = null;
let microphoneStream = null;
let audioDataArray = null;
let audioInitialized = false;
let audioInitializationError = null;

// Temporizadores para mantener la interacción activa tras un disparo sónico
let neonTrembleUntil = 0;
let pinsTrembleUntil = 0;

// Estado exclusivo de sonido activo (NONE, NEON, PINS, CONTRACTION)
let activeSoundType = "NONE";
let soundStartTime = 0;

// Variables globales para el análisis de frecuencia (nuevos disparadores)
let whistleActive = false; // Silbidos (frecuencias agudas)
let hissActive = false;    // Siseos (frecuencias medias-altas)
let buzzActive = false;    // Zumbidos (frecuencias graves)

// Variables para el respaldo acústico (peak detection) del ritmo vocal "gluglu"
let isGluPeakActive = false;
let gluPeakStartTime = 0;
let lastGluPeakTime = 0;

// Variables para el sistema de silencio y desvanecimiento
let lastSoundTime = 0;
let isFadedOut = false;
let globalAlphaMod = 1.0;
const THRESHOLD_SILENCE = 28; // Elevado de 15 a 28 para ignorar ruidos constantes (como ventilador de notebook)
let consecutiveSoundFrames = 0; // Para filtrar ruidos cortos imprevistos (clics, teclado)
let hasRegeneratedInSilence = false;


// Umbrales calibrados para los disparadores de audio
const THRESHOLD_SILBIDO = 130;     // Umbral para silbido (Contracción)
const THRESHOLD_GRAVE = 180;       // Umbral para grave medio (Vibración de Neón, elevado a 180 para evitar interferencias con habla)
const THRESHOLD_SISEO = 40;        // Umbral mínimo para siseo (Vibración de Pines, sin límite superior)

let showDebug = false;             // Mostrar panel de depuración en tiempo real por defecto
function preload() {
  // Cargar las 10 variantes de burbujas en escala de grises
  for (let i = 1; i <= 10; i++) {
    bubbleImages.push(loadImage(`cilindros y burbujitas/${i}_burbuja.png`));
  }
  
  // Cargar los 6 tipos de cilindros en escala de grises
  cylinderImages.corto.claro = loadImage('cilindros y burbujitas/cilindro corto claro.png');
  cylinderImages.corto.oscuro = loadImage('cilindros y burbujitas/cilindro corto oscuro.png');
  cylinderImages.mediano.claro = loadImage('cilindros y burbujitas/cilindro mediano claro.png');
  cylinderImages.mediano.oscuro = loadImage('cilindros y burbujitas/cilindro mediano oscuro.png');
  cylinderImages.largo.claro = loadImage('cilindros y burbujitas/cilindro largo claro.png');
  cylinderImages.largo.oscuro = loadImage('cilindros y burbujitas/cilindro largo oscuro.png');
}

function setup() {
  let canvas = createCanvas(640, 480);
  // Centrar el lienzo en el cuerpo de la página
  canvas.parent(document.body);
  generarComposicion();
  
  // Vincular botón externo de activación de micrófono
  let btnMic = document.getElementById('btn-mic');
  if (btnMic) {
    btnMic.addEventListener('click', () => {
      if (!audioInitialized) {
        initAudio();
      }
    });
  }
}

function draw() {
  background(10, 10, 12); 
  
  let isInteractingLength = false;
  
  // Procesamiento de audio en tiempo real
  if (audioInitialized && analyser) {
    analyser.getByteFrequencyData(audioDataArray);
    
    // Separación física en bins disjuntos y audibles para evitar solapamientos
    let energyZumbido = getAverageVolume(audioDataArray, 3, 11);   // 130-470 Hz (Grave medio / Voz humana)
    let energySilbido = getAverageVolume(audioDataArray, 23, 47);  // 1000-2000 Hz (Silbido puro)
    let energySiseo = getAverageVolume(audioDataArray, 70, 187);   // 3000-8000 Hz (Siseo de fricción "Ssss")
    let voiceEnergy = getAverageVolume(audioDataArray, 3, 10);    // 150-400 Hz (Voz humana)
    let overallVolume = getAverageVolume(audioDataArray, 0, audioDataArray.length);
    
    let now = millis();
    
    // Detector de silencio / sonido activo (umbrales elevados para filtrar el ruido de fondo constante de ventiladores)
    let isSoundDetected = (overallVolume > THRESHOLD_SILENCE || energyZumbido > 60 || energySilbido > 60 || energySiseo > 30 || voiceEnergy > 55);
    
    if (isSoundDetected) {
      if (isFadedOut) {
        consecutiveSoundFrames++;
        if (consecutiveSoundFrames > 12) { // Requiere ~200ms de sonido sostenido (evita clics accidentales de mouse/teclado)
          lastSoundTime = now;
          isFadedOut = false;
          consecutiveSoundFrames = 0;
          hasRegeneratedInSilence = false; // Resetear bandera al despertar
          console.log("[Silence System]: Sonido sostenido detectado. Despertando con nueva composición.");
        }
      } else {
        lastSoundTime = now;
        consecutiveSoundFrames = 0;
      }
    } else {
      consecutiveSoundFrames = 0;
    }
    
    // Control del modificador de opacidad (desvanecimiento tras 4 segundos de silencio - 50% más rápido)
    if (now - lastSoundTime > 4000) {
      isFadedOut = true;
      globalAlphaMod = max(0.0, globalAlphaMod - 0.033); // Se desvanece un 50% más rápido
      
      // Regenerar la composición en silencio apenas la pantalla esté completamente negra
      if (globalAlphaMod === 0.0 && !hasRegeneratedInSilence) {
        generarComposicion(false); // Regenerar en silencio
        hasRegeneratedInSilence = true;
        console.log("[Silence System]: Obra completamente desvanecida. Regenerando en silencio.");
      }
    } else {
      isFadedOut = false;
      hasRegeneratedInSilence = false;
      globalAlphaMod = min(1.0, globalAlphaMod + 0.06); // Reaparece rápidamente (menos latencia de respuesta)
    }
    
    // REGLA DE PRIORIDAD: Si las burbujas están activas por voz/K, suprimimos otras detecciones y limpiamos vibraciones
    let isSpeechActive = (now < bubbleMoveUntil);
    if (isSpeechActive) {
      activeSoundType = "NONE";
      neonTrembleUntil = 0;
      pinsTrembleUntil = 0;
    }
    
    // DETECTOR DE RUIDO DE BANDA ANCHA INTELIGENTE
    // Consideramos ruido si múltiples bandas están activas al mismo tiempo, a menos que 
    // haya un tono voluntario dominante y claro.
    let isNoise = false;
    let bandsActive = 0;
    if (energyZumbido > THRESHOLD_SISEO) bandsActive++;
    if (energySilbido > THRESHOLD_SISEO) bandsActive++;
    if (energySiseo > THRESHOLD_SISEO) bandsActive++;
    
    if (bandsActive >= 2) {
      // Definimos si hay un tono dominante claro frente a las demás bandas
      // El silbido es dominante si supera su umbral y los graves de fondo están controlados (< 90)
      let isDominantSilbido = (energySilbido > THRESHOLD_SILBIDO && energyZumbido < 90);
      // El grave es dominante si supera su umbral y los silbidos están controlados (< 90)
      let isDominantZumbido = (energyZumbido > THRESHOLD_GRAVE && energySilbido < 90);
      // El siseo es dominante si supera su umbral mínimo y no hay energía alta en graves ni en silbidos (ambos < 80)
      let isDominantSiseo = (energySiseo > THRESHOLD_SISEO && energyZumbido < 80 && energySilbido < 80);
      
      // Si no hay ninguna banda dominante y clara, se considera ruido de banda ancha (roces, clics)
      if (!isDominantSilbido && !isDominantZumbido && !isDominantSiseo) {
        isNoise = true;
      }
    }
    
    // --- 1. DETECTOR ACÚSTICO DE RESPALDO PARA "GLUGLU" ---
    // Detecta dos picos rápidos de voz en un intervalo corto (200-600ms)
    // No bloqueamos por isNoise ni por activeSoundType aquí, porque la voz humana es naturalmente de banda ancha (multibanda)
    // y el primer pico 'glu' puede activar transitoriamente otro estado de audio.
    if (!isSpeechActive) {
      if (voiceEnergy > 80) { // Reducido de 95 a 80 para mayor sensibilidad en micrófonos promedio
        if (!isGluPeakActive) {
          gluPeakStartTime = now;
          isGluPeakActive = true;
        }
      } else {
        if (isGluPeakActive) {
          let peakDuration = now - gluPeakStartTime;
          if (peakDuration >= 45 && peakDuration <= 315) { // Duración de sílaba (10% menos latencia)
            let timeGap = now - lastGluPeakTime;
            if (timeGap >= 135 && timeGap <= 540) { // Patrón de doble pico (10% menos latencia)
              bubbleMoveUntil = now + 4000; // Mueve burbujas por 4 segundos
              isSpeechActive = true;
              console.log("[Acoustic Fallback]: Detectado ritmo de 'gluglu'!");
            }
            lastGluPeakTime = now;
          }
          isGluPeakActive = false;
        }
      }
    }
    
    // --- 2. SISTEMA DE EXCLUSIVIDAD (STATE LOCKING) ---
    if (activeSoundType === "NONE" && !isSpeechActive && !isNoise && !isFadedOut) {
      // Intentar activar una nueva interacción de forma mutuamente excluyente
      if (energySilbido > THRESHOLD_SILBIDO) {
        activeSoundType = "CONTRACTION"; // Silbido -> Solo acortar
      } else if (energyZumbido > THRESHOLD_GRAVE) {
        activeSoundType = "NEON";         // Grave medio -> Vibrate cylinders (neon)
        soundStartTime = now;
      } else if (energySiseo > THRESHOLD_SISEO) {
        activeSoundType = "PINS";         // Siseo -> Vibrate pins (LEDs)
        soundStartTime = now;
      }
    }
    
    // Monitorear y resolver el estado activo (solo si no se activaron las burbujas por voz)
    if (!isSpeechActive) {
      if (activeSoundType === "CONTRACTION") {
        if (energySilbido < THRESHOLD_SILBIDO) {
          activeSoundType = "NONE"; // Liberar al silenciar
        } else {
          // Acortar cilindros en tiempo real de forma responsiva mientras silbas
          globalLengthMod -= 0.05;
          if (globalLengthMod < 0.2) globalLengthMod = 0.2;
          isInteractingLength = true;
        }
      } else if (activeSoundType === "NEON") {
        if (energyZumbido < THRESHOLD_GRAVE) {
          let duration = (now - soundStartTime) / 1000.0;
          if (duration >= 0.54 && duration <= 2.7) { // Ventana de detección (10% menos latencia)
            // Si hubo un pico de voz reciente, no vibramos los cilindros (es habla, no zumbido)
            if (now - lastGluPeakTime > 1500) {
              neonTrembleUntil = now + 2000; // Cilindros (neón) vibran por 2s
            } else {
              console.log("[Speech Filter]: Filtrada vibración accidental de cilindros durante habla.");
            }
          }
          activeSoundType = "NONE";
        }
      } else if (activeSoundType === "PINS") {
        if (energySiseo < THRESHOLD_SISEO) {
          let duration = (now - soundStartTime) / 1000.0;
          if (duration >= 0.54 && duration <= 2.7) { // Ventana de detección (10% menos latencia)
            pinsTrembleUntil = now + 2000; // Pines LED vibran por 2s
          }
          activeSoundType = "NONE";
        }
      }
    }
    
    // Actualizar medidores del panel externo HTML en tiempo real
    updateHTMLMeter('silbido', energySilbido, THRESHOLD_SILBIDO);
    updateHTMLMeter('grave', energyZumbido, THRESHOLD_GRAVE);
    updateHTMLMeter('siseo', energySiseo, THRESHOLD_SISEO);
    updateHTMLMeter('voz', voiceEnergy, 80);
    
    // Actualizar el temporizador de silencio en HTML
    let silenceTimerEl = document.getElementById('silence-timer');
    if (silenceTimerEl) {
      let silenceSecs = (now - lastSoundTime) / 1000.0;
      silenceSecs = max(0.0, silenceSecs);
      if (silenceSecs >= 4.0) {
        silenceTimerEl.innerText = `${silenceSecs.toFixed(1)}s / 4.0s (Apagado)`;
        silenceTimerEl.style.color = '#FF0055'; // Rosa neón
      } else {
        silenceTimerEl.innerText = `${silenceSecs.toFixed(1)}s / 4.0s`;
        silenceTimerEl.style.color = '#00A8FF'; // Celeste neón
      }
    }
  } else {
    // Si el audio no está inicializado, medidores en cero
    updateHTMLMeter('silbido', 0, THRESHOLD_SILBIDO);
    updateHTMLMeter('grave', 0, THRESHOLD_GRAVE);
    updateHTMLMeter('siseo', 0, THRESHOLD_SISEO);
    updateHTMLMeter('voz', 0, 80);
    
    let silenceTimerEl = document.getElementById('silence-timer');
    if (silenceTimerEl) {
      silenceTimerEl.innerText = '0.0s / 4.0s';
      silenceTimerEl.style.color = '#bbbbbb';
    }
  }
  
  // Fallback Físico - Tecla 0: Acortar (cuenta como entrada de interacción, resetea temporizador de silencio)
  if (keyIsDown(48) || keyIsDown(96)) {
    globalLengthMod -= 0.025;
    if (globalLengthMod < 0.2) globalLengthMod = 0.2;
    isInteractingLength = true;
    lastSoundTime = millis();
  }
  
  // Retorno elástico al estado original (10% más rápido para menor latencia de retorno)
  if (!isInteractingLength) {
    globalLengthMod += (1.0 - globalLengthMod) * 0.11;
  }
  
  for (let b of blocks) {
    b.draw();
  }
  

}

function mousePressed() {
  if (!audioInitialized) {
    initAudio();
  }
}

async function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphoneStream = audioCtx.createMediaStreamSource(stream);
    
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4; // Reducido de 0.8 para acelerar la reacción sónica (menos latencia)
    const bufferLength = analyser.frequencyBinCount;
    audioDataArray = new Uint8Array(bufferLength);
    
    microphoneStream.connect(analyser);
    audioInitialized = true;
    
    // Inicializar el temporizador de silencio con el tiempo actual
    lastSoundTime = millis();
    
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    
    // Actualizar estado del botón en el panel HTML
    let btnMic = document.getElementById('btn-mic');
    if (btnMic) {
      btnMic.innerText = "MICRÓFONO ACTIVO";
      btnMic.classList.add('active');
    }
    
    // Inicializar reconocimiento de voz en paralelo para la palabra "gluglu"
    initSpeechRecognition();
  } catch (err) {
    audioInitializationError = err.message;
    let btnMic = document.getElementById('btn-mic');
    if (btnMic) {
      btnMic.innerText = "ERROR AL ACTIVAR";
    }
  }
}

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("Este navegador no soporta Web Speech API.");
    return;
  }
  
  let recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'es-AR'; // Español rioplatense/latino
  
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      let transcript = event.results[i][0].transcript.toLowerCase();
      // Detectar variaciones de la palabra "gluglu" o sílabas asociadas
      if (transcript.includes("gluglu") || transcript.includes("glu glu") || 
          transcript.includes("glu") || transcript.includes("lu") || 
          transcript.includes("gugu") || transcript.includes("globo")) {
        console.log("[Reconocedor de Voz Escuchó patrón de burbujas]:", transcript);
        bubbleMoveUntil = millis() + 4000; // Mueve burbujas por 4 segundos
        console.log("¡Disparo de Burbujas Activado por Voz!");
      }
    }
  };
  
  recognition.onend = () => {
    // Mantener la escucha activa de forma continua si el audio general sigue inicializado
    if (audioInitialized) {
      try {
        recognition.start();
      } catch (e) {
        // Ignorar si ya se está inicializando
      }
    }
  };
  
  try {
    recognition.start();
  } catch (e) {
    console.error("No se pudo iniciar el reconocedor de voz:", e);
  }
}

function getAverageVolume(array, start, end) {
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    sum += array[i];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function keyPressed() {
  if (key === 'k' || key === 'K') {
    bubbleMoveUntil = millis() + 1000;
    lastSoundTime = millis(); // Cuenta como entrada de interacción
  }
  if (key === 'd' || key === 'D') {
    showDebug = !showDebug;
    lastSoundTime = millis(); // Cuenta como entrada de interacción
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    let j = floor(random(i + 1));
    let temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

function generarComposicion(useFixedSeed = true) {
  if (useFixedSeed) {
    randomSeed(1805); 
  } else {
    // Generar una semilla aleatoria nueva para re-posicionar los bloques
    randomSeed(floor(random(1000000)));
  }
  
  blocks = [];
  globalLengthMod = 1.0;
  
  let cols = 4; 
  let rows = 3;
  let cellW = width / cols;
  let cellH = height / rows;
  
  let numCells = cols * rows; 
  let totalTarget = 12; 
  
  let orientations = [];
  let matrixSizes = [];
  let dotSizes = []; 
  let longSizes = []; 
  let capPins = []; 
  let longTubes = []; 
  
  for (let i = 0; i < totalTarget / 2; i++) {
    orientations.push(true, false);
    matrixSizes.push(true, false);
    dotSizes.push(true, false); 
    longSizes.push(true, false); 
  }
  
  let doublePins = [];
  for (let i = 0; i < totalTarget; i++) {
     doublePins.push(i < 4); 
     capPins.push(i < floor(totalTarget * 0.3)); 
     longTubes.push(i < floor(totalTarget * 0.2)); 
  }
  
  shuffleArray(orientations);
  shuffleArray(matrixSizes);
  shuffleArray(dotSizes);
  shuffleArray(longSizes);
  shuffleArray(doublePins);
  shuffleArray(capPins);
  shuffleArray(longTubes);
  
  let cells = [];
  for (let i = 0; i < numCells; i++) cells.push(i);
  
  let selectedCells;
  while (true) {
    shuffleArray(cells);
    selectedCells = cells.slice(0, totalTarget);
    break;
  }
  
  let fixedThickness = 72; 
  let blockColors = [];
  for(let i=0; i<totalTarget; i++) {
      blockColors.push(MADI_COLORS[i % MADI_COLORS.length]);
  }
  shuffleArray(blockColors);
  
  for (let i = 0; i < totalTarget; i++) {
    let cellIndex = selectedCells[i];
    let col = cellIndex % cols;
    let row = floor(cellIndex / cols);
    
    let anchorX = col * cellW + cellW / 2;
    let anchorY = row * cellH + cellH / 2;
    
    let isVertical = orientations[i];
    let isLargeMatrix = matrixSizes[i];
    let hasLargeDots = dotSizes[i]; 
    let hasDoublePins = doublePins[i];
    let isLongMatrix = longSizes[i];
    let hasCapPins = capPins[i];
    let isExtraLong = longTubes[i];
    
    let lengthFactor = isExtraLong ? 0.715 : 0.55;
    
    let bw, bh;
    if (isVertical) {
       bw = fixedThickness; 
       bh = cellH * lengthFactor; 
    } else {
       bw = cellW * lengthFactor; 
       bh = fixedThickness;
    }
    
    let c = color(blockColors[i]);
    
    blocks.push(new KosiceBlock(anchorX, anchorY, bw, bh, isVertical, c, isLargeMatrix, hasLargeDots, hasDoublePins, isLongMatrix, hasCapPins, cellW, cellH));
  }
}

class KosiceBlock {
  constructor(x, y, w, h, isVertical, col, isLargeMatrix, hasLargeDots, hasDoublePins, isLongMatrix, hasCapPins, cellW, cellH) {
    this.x = x;
    this.y = y;
    this.baseW = w;
    this.baseH = h;
    this.isVertical = isVertical;
    this.color = col;
    this.isLargeMatrix = isLargeMatrix;
    this.hasLargeDots = hasLargeDots; 
    this.hasDoublePins = hasDoublePins;
    this.isLongMatrix = isLongMatrix;
    this.hasCapPins = hasCapPins;
    
    // Determinar el tipo de cilindro (corto, mediano, largo) según flags y longitud física
    let physLength = this.isVertical ? this.baseH : this.baseW;
    let isExtraLong = physLength > 150;
    if (isExtraLong) {
      this.cylinderType = 'largo';
    } else if (this.isLongMatrix) {
      this.cylinderType = 'mediano';
    } else {
      this.cylinderType = 'corto';
    }
    
    // Determinar el estilo de sombreado (claro vs oscuro) por luminosidad de color
    let cBase = color(this.color);
    let luminance = (red(cBase) * 299 + green(cBase) * 587 + blue(cBase) * 114) / 1000;
    this.shadingStyle = (luminance > 120) ? 'claro' : 'oscuro';
    
    // Easing de velocidad para movimiento fluido de burbujas
    this.bubbleSpeedFactor = 0.0;
    
    if (this.hasDoublePins && this.hasCapPins) {
       this.hasCapPins = false; 
     }
     
     this.bubbles = [];
     let numBubbles = floor(random(6, 15));
     for (let i = 0; i < numBubbles; i++) {
         let maxDistX = (this.baseW / 2) * 0.7;
         let maxDistY = (this.baseH / 2) * 0.7;
         let bx = random(-maxDistX, maxDistX);
         let by = random(-maxDistY, maxDistY);
         let minR = this.isVertical ? this.baseW * 0.15 : this.baseH * 0.15;
         let maxR = this.isVertical ? this.baseW * 0.5 : this.baseH * 0.5;
         let br = random(minR, maxR);
         let speed = map(br, minR, maxR, 2.16, 6.75); // Conservamos la velocidad aumentada
         
         // Índice determinista de imagen de burbuja (0 a 9) basado en el índice de bucle
         let imgIndex = i % 10;
         
         this.bubbles.push({
           x: bx, y: by, r: br, 
           speed: speed, wobbleSpeed: random(0.05, 0.15), wobbleOffset: random(0, TWO_PI), wobbleAmp: random(0.2, 0.8),
           imgIndex: imgIndex
         });
     }
    
    this.pins = [];
    let pinSide = random() > 0.5 ? 1 : -1;
    
    let dotSpacing = 6; 
    let pinSeparation = 8; 
    
    let colsThickness = this.isLargeMatrix ? 6 : 4; 
    let maxRows = floor((this.isVertical ? this.baseH : this.baseW) / dotSpacing);
    let minRows = colsThickness + 2; 
    
    let rowsToDraw;
    if (this.isLongMatrix) {
        rowsToDraw = maxRows;
    } else {
        rowsToDraw = floor(random(minRows, maxRows - 1)); 
    }
    
    if (this.isVertical) {
       let cols = colsThickness; 
       let rows = rowsToDraw;
       
       let startY;
       if (this.isLongMatrix) {
           startY = -this.baseH/2 + dotSpacing/2; 
       } else {
           if (random() > 0.5) startY = -this.baseH/2 + dotSpacing*2; 
           else startY = this.baseH/2 - (rows * dotSpacing) - dotSpacing*2;
       }
       
       let sides = this.hasDoublePins ? [1, -1] : [pinSide];
       
       for (let side of sides) {
           let startX = (this.baseW / 2 + pinSeparation) * side;
           for (let i = 0; i < cols; i++) {
               for (let j = 0; j < rows; j++) {
                   let px = startX + (i * dotSpacing * side);
                   let py = startY + (j * dotSpacing);
                   this.pins.push({x: px, y: py});
               }
           }
       }
       
       if (this.hasCapPins) {
           let capSide = random() > 0.5 ? 1 : -1; 
           let capCols = this.isLargeMatrix ? 8 : 5; 
           let capRows = 2; 
           
           let cStartY = (this.baseH / 2 + pinSeparation) * capSide;
           let cStartX = - (capCols * dotSpacing) / 2 + dotSpacing / 2; 
           
           for (let i = 0; i < capCols; i++) {
               for (let j = 0; j < capRows; j++) {
                   let px = cStartX + (i * dotSpacing);
                   let py = cStartY + (j * dotSpacing * capSide);
                   this.pins.push({x: px, y: py});
               }
           }
       }
       
    } else {
       let tempCols = rowsToDraw; 
       let tempRows = colsThickness; 
       
       let startX;
       if (this.isLongMatrix) {
           startX = -this.baseW/2 + dotSpacing/2; 
       } else {
           if (random() > 0.5) startX = -this.baseW/2 + dotSpacing*2; 
           else startX = this.baseW/2 - (tempCols * dotSpacing) - dotSpacing*2;
       }
       
       let sides = this.hasDoublePins ? [1, -1] : [pinSide];
       
       for (let side of sides) {
           let startY = (this.baseH / 2 + pinSeparation) * side;
           for (let j = 0; j < tempRows; j++) {
               for (let i = 0; i < tempCols; i++) {
                   let px = startX + (i * dotSpacing);
                   let py = startY + (j * dotSpacing * side);
                   this.pins.push({x: px, y: py});
               }
           }
       }
       
       if (this.hasCapPins) {
           let capSide = random() > 0.5 ? 1 : -1; 
           let capRows = this.isLargeMatrix ? 8 : 5; 
           let capCols = 2; 
           
           let cStartX = (this.baseW / 2 + pinSeparation) * capSide;
           let cStartY = - (capRows * dotSpacing) / 2 + dotSpacing / 2; 
           
           for (let j = 0; j < capRows; j++) {
               for (let i = 0; i < capCols; i++) {
                   let px = cStartX + (i * dotSpacing * capSide);
                   let py = cStartY + (j * dotSpacing);
                   this.pins.push({x: px, y: py});
               }
           }
       }
    }
  }

  draw() {
    push();
    
    // Las figuras vuelven a estar ancladas estáticamente a su posición original
    translate(this.x, this.y);
    
    let currentW, currentH;
    if (this.isVertical) {
       currentW = this.baseW;
       currentH = this.baseH * globalLengthMod;
    } else {
       currentW = this.baseW * globalLengthMod;
       currentH = this.baseH;
    }
    
    let isCylindersTrembling = (millis() < neonTrembleUntil);
    let isPinsTrembling = (millis() < pinsTrembleUntil); 
    
    noStroke();
    fill(255, 255, 255, 255 * globalAlphaMod);
    drawingContext.shadowBlur = 8 * globalAlphaMod;
    drawingContext.shadowColor = `rgba(255, 255, 255, ${0.9 * globalAlphaMod})`;
    
    let dotRadius = this.hasLargeDots ? 3.0 : 1.8; 
    
    for(let p of this.pins) {
      let pinDx = isPinsTrembling ? random(-2.5, 2.5) : 0;
      let pinDy = isPinsTrembling ? random(-2.5, 2.5) : 0;
      circle(p.x + pinDx, p.y + pinDy, dotRadius);
    }
    
    drawingContext.shadowBlur = 0;
    
    push();
    if (isCylindersTrembling) {
       let ctx = random(-4, 4);
       let cty = random(-4, 4);
       translate(ctx, cty);
    }
    
    // Configurar el resplandor neón en la sombra de la imagen
    drawingContext.shadowBlur = 60 * globalAlphaMod;
    let shadowCol = color(this.color);
    shadowCol.setAlpha(alpha(shadowCol) * globalAlphaMod);
    drawingContext.shadowColor = shadowCol.toString();
    
    // Tintar el cilindro con su color Madi y la opacidad global
    let cBase = color(this.color);
    cBase.setAlpha(255 * globalAlphaMod);
    tint(cBase);
    
    // Dibujar la imagen del cilindro correspondiente
    let cylinderImg = cylinderImages[this.cylinderType][this.shadingStyle];
    if (this.isVertical) {
       image(cylinderImg, -currentW/2, -currentH/2, currentW, currentH);
    } else {
       push();
       rotate(HALF_PI);
       image(cylinderImg, -currentH/2, -currentW/2, currentH, currentW);
       pop();
    }
    
    // Dibujar un borde vectorial suave para enmascarar imperfecciones del borde del PNG
    stroke(red(cBase) * 0.4, green(cBase) * 0.4, blue(cBase) * 0.4, 220 * globalAlphaMod);
    strokeWeight(1.2);
    noFill();
    rectMode(CENTER);
    rect(0, 0, currentW - 0.5, currentH - 0.5);
    noStroke();
    
    noTint();
    drawingContext.shadowBlur = 0;
    
    // Máscara de recorte rectangular para las burbujas internas sin pintar un rectángulo
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.rect(-currentW/2, -currentH/2, currentW, currentH);
    drawingContext.clip();
    
    let isMoving = keyIsDown(75) || millis() < bubbleMoveUntil;
    let targetSpeedFactor = isMoving ? 1.0 : 0.0;
    
    // Easing de la velocidad para aceleración y desaceleración fluidas (hidrodinámicas)
    this.bubbleSpeedFactor += (targetSpeedFactor - this.bubbleSpeedFactor) * 0.08;
    
    for(let b of this.bubbles) {
      if (this.bubbleSpeedFactor > 0.001) {
        // Ondulación armónica doble para simular corrientes de agua más naturales
        let wobble = (sin(frameCount * b.wobbleSpeed + b.wobbleOffset) + cos(frameCount * b.wobbleSpeed * 0.5)) * b.wobbleAmp * 0.7;
        if (this.isVertical) {
          b.y -= b.speed * this.bubbleSpeedFactor; 
          b.x += wobble * this.bubbleSpeedFactor;
          if (b.y < -currentH / 2 - b.r) b.y = currentH / 2 + b.r; 
        } else {
          b.x -= b.speed * this.bubbleSpeedFactor; 
          b.y += wobble * this.bubbleSpeedFactor;
          if (b.x < -currentW / 2 - b.r) b.x = currentW / 2 + b.r;
        }
      }
      
      if (this.isVertical && b.y < -currentH / 2 - b.r) b.y = currentH / 2 + b.r;
      if (!this.isVertical && b.x < -currentW / 2 - b.r) b.x = currentW / 2 + b.r;
      
      let rX = this.isVertical ? b.r : b.r * 1.3;
      let rY = this.isVertical ? b.r * 1.3 : b.r;
      
      // Dibujar la imagen de la burbuja tintada en blanco con opacidad global
      let bubbleColor = color(255);
      bubbleColor.setAlpha(255 * globalAlphaMod);
      tint(bubbleColor);
      let bubbleImg = bubbleImages[b.imgIndex];
      image(bubbleImg, b.x - rX/2, b.y - rY/2, rX, rY);
      noTint();
    }
    
    drawingContext.restore();
    pop(); 
    pop(); 
  }
}

// Función auxiliar para actualizar los medidores en el panel HTML externo
function updateHTMLMeter(name, value, threshold) {
  let valEl = document.getElementById(`val-${name}`);
  let fillEl = document.getElementById(`fill-${name}`);
  if (valEl && fillEl) {
    valEl.innerText = `${Math.round(value)} / ${threshold}`;
    let pct = Math.min((value / threshold) * 100, 100);
    fillEl.style.width = `${pct}%`;
    if (value >= threshold) {
      fillEl.style.filter = "brightness(1.5) drop-shadow(0 0 4px rgba(255, 255, 255, 0.8))";
    } else {
      fillEl.style.filter = "none";
    }
  }
}

