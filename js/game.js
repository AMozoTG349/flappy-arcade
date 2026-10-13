'use strict';

/* ============================================================
 * Flappy — HTML5 + Canvas 2D + JS vanilla, sin dependencias.
 * Estética propia y procedural (sin assets externos).
 * Resolución lógica fija 360x640 escalada al viewport.
 * ============================================================ */

// --- Configuración (ajustar aquí la jugabilidad) ---
const LOGICAL_WIDTH = 360;
const LOGICAL_HEIGHT = 640;
const GROUND_HEIGHT = 88;

const GRAVITY = 1800;        // px/s^2 hacia abajo
const FLAP_VELOCITY = -540;  // impulso vertical al aletear
const MAX_FALL_SPEED = 760;  // velocidad terminal de caída

const BIRD_X_RATIO = 0.25;   // x fija del pájaro (25% del ancho)
const BIRD_W = 34;           // ancho visual del pájaro
const BIRD_H = 26;           // alto visual del pájaro
const HITBOX_MARGIN = 5;     // perdón: hitbox menor que el dibujo
const PIPE_HITBOX_MARGIN = 3;

const PIPE_WIDTH = 64;
const PIPE_SPACING = 205;    // distancia horizontal entre tubos (no por tiempo)
const PIPE_MIN_MARGIN = 70;  // margen vertical mínimo del hueco a borde/suelo

const BASE_SPEED = 155;      // velocidad base de scroll (px/s)
const MAX_SPEED = 275;
const SPEED_PER_POINT = 2.5; // subida de velocidad por punto

const BASE_GAP = 152;        // hueco vertical inicial entre tubos
const MIN_GAP = 108;
const GAP_SHRINK_PER_POINT = 0.9;

const MAX_DELTA = 1 / 30;    // cota de delta-time (pestañas en background)
const HIGH_SCORE_KEY = 'flappy.highscore';
const RESTART_DELAY_MS = 900; // anti-tap accidental en game over

const MEDAL_THRESHOLDS = [
  { min: 40, name: 'Diamante', cls: 'diamond' },
  { min: 30, name: 'Oro', cls: 'gold' },
  { min: 20, name: 'Plata', cls: 'silver' },
  { min: 10, name: 'Bronce', cls: 'bronze' },
];

// --- Estados del juego ---
const STATE = { READY: 'READY', PLAYING: 'PLAYING', GAME_OVER: 'GAME_OVER' };

// --- Referencias DOM ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const overlayReady = document.getElementById('overlay-ready');
const overlayGameOver = document.getElementById('overlay-gameover');
const hudScore = document.getElementById('hud-score');
const hudBest = document.getElementById('hud-best');
const finalScore = document.getElementById('final-score');
const finalBest = document.getElementById('final-best');
const medalEl = document.getElementById('medal');
const restartBtn = document.getElementById('restart-btn');

// --- Estado mutable ---
let state = STATE.READY;
let lastTime = 0;
let elapsed = 0;
let score = 0;
let best = loadBest();
let gameOverAt = 0;

const bird = {
  x: LOGICAL_WIDTH * BIRD_X_RATIO,
  y: LOGICAL_HEIGHT * 0.45,
  vy: 0,
  angle: 0, // rotación suavizada según vy
  wingPhase: 0,
};

let pipes = []; // { x, gapY, gapH, scored }
let distanceSincePipe = 0;
let groundX = 0; // desplazamiento del suelo
let hillX = 0;
let clouds = [];

// Dificultad actual derivada del score (con topes).
function currentSpeed() {
  return Math.min(MAX_SPEED, BASE_SPEED + score * SPEED_PER_POINT);
}

function currentGap() {
  return Math.max(MIN_GAP, BASE_GAP - score * GAP_SHRINK_PER_POINT);
}

function loadBest() {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0; // file:// o modo privado pueden bloquear localStorage
  }
}

function saveBest() {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(best));
  } catch {
    // Sin persistencia disponible: se juega igual, sin récord guardado.
  }
}

function medalFor(s) {
  for (const m of MEDAL_THRESHOLDS) {
    if (s >= m.min) return m;
  }
  return { min: 0, name: 'Sin medalla', cls: 'none' };
}

// --- Escalado: lógica fija + letterbox + devicePixelRatio ---
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(LOGICAL_WIDTH * dpr);
  canvas.height = Math.round(LOGICAL_HEIGHT * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Escala CSS que cabe en el área de contenido del body (descuenta su
  // padding) manteniendo aspecto, para no recortar el canvas.
  const bodyStyle = getComputedStyle(document.body);
  const padX =
    (parseFloat(bodyStyle.paddingLeft) || 0) + (parseFloat(bodyStyle.paddingRight) || 0);
  const padY =
    (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
  const availW = Math.max(1, window.innerWidth - padX);
  const availH = Math.max(1, window.innerHeight - padY);
  const scale = Math.min(availW / LOGICAL_WIDTH, availH / LOGICAL_HEIGHT);
  const cssW = Math.max(1, Math.floor(LOGICAL_WIDTH * scale));
  const cssH = Math.max(1, Math.floor(LOGICAL_HEIGHT * scale));
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  stage.style.width = cssW + 'px';
  stage.style.height = cssH + 'px';
}

// --- Flujo de juego ---
function resetWorld() {
  score = 0;
  pipes = [];
  distanceSincePipe = 0;
  groundX = 0;
  hillX = 0;
  bird.y = LOGICAL_HEIGHT * 0.45;
  bird.vy = 0;
  bird.angle = 0;
  bird.wingPhase = 0;
  clouds = makeClouds();
  updateHud();
}

function startGame() {
  resetWorld();
  state = STATE.PLAYING;
  overlayReady.classList.add('hidden');
  overlayGameOver.classList.add('hidden');
  flap();
}

function endGame() {
  state = STATE.GAME_OVER;
  gameOverAt = performance.now();
  if (score > best) {
    best = score;
    saveBest();
  }
  finalScore.textContent = String(score);
  finalBest.textContent = String(best);
  const medal = medalFor(score);
  medalEl.innerHTML = '';
  const coin = document.createElement('span');
  coin.className = 'coin ' + medal.cls;
  medalEl.appendChild(coin);
  medalEl.appendChild(document.createTextNode(medal.name));
  overlayGameOver.classList.remove('hidden');
  restartBtn.disabled = true; // se habilita tras el delay anti-tap
  updateHud();
}

function flap() {
  bird.vy = FLAP_VELOCITY;
  bird.wingPhase = 0; // reinicia el batido del ala
}

// Entrada unificada: todo gesto válido hace flap (o cambia de estado).
function handlePress() {
  if (state === STATE.READY) {
    startGame();
  } else if (state === STATE.PLAYING) {
    flap();
  }
  // En GAME_OVER solo vale el botón tras el delay (anti-tap de la muerte).
}

function makeClouds() {
  const list = [];
  let x = 0;
  while (x < LOGICAL_WIDTH + 120) {
    list.push({
      x: x + Math.random() * 90,
      y: 30 + Math.random() * 220,
      s: 0.6 + Math.random() * 0.9,
    });
    x += 90 + Math.random() * 70;
  }
  return list;
}

function spawnPipe() {
  const gapH = currentGap();
  const topLimit = PIPE_MIN_MARGIN + gapH / 2;
  const bottomLimit = LOGICAL_HEIGHT - GROUND_HEIGHT - PIPE_MIN_MARGIN - gapH / 2;
  const gapY = topLimit + Math.random() * Math.max(1, bottomLimit - topLimit);
  pipes.push({ x: LOGICAL_WIDTH + 10, gapY, gapH, scored: false });
}

// --- Update ---
function update(dt) {
  elapsed += dt;
  const speed = currentSpeed();

  // Parallax siempre en marcha (también en READY da vida al fondo).
  groundX = (groundX + speed * dt) % 48;
  hillX = (hillX + speed * 0.35 * dt) % LOGICAL_WIDTH;
  for (const c of clouds) {
    c.x -= speed * 0.15 * dt;
    if (c.x < -90) {
      c.x = LOGICAL_WIDTH + 60 + Math.random() * 40;
      c.y = 30 + Math.random() * 220;
    }
  }

  if (state === STATE.READY) {
    // Flotación suave esperando el primer tap.
    bird.y = LOGICAL_HEIGHT * 0.45 + Math.sin(elapsed * 4) * 8;
    bird.vy = 0;
    bird.angle += (0 - bird.angle) * Math.min(1, dt * 8);
    bird.wingPhase += dt * 10;
    return;
  }

  if (state === STATE.GAME_OVER) {
    // Habilita el reinicio pasado el delay anti-tap.
    if (restartBtn.disabled && performance.now() - gameOverAt >= RESTART_DELAY_MS) {
      restartBtn.disabled = false;
    }
    return;
  }

  // --- PLAYING ---
  bird.vy = Math.min(MAX_FALL_SPEED, bird.vy + GRAVITY * dt);
  bird.y += bird.vy * dt;
  bird.wingPhase += dt * (bird.vy < 0 ? 22 : 10);

  // Rotación según velocidad vertical, con suavizado.
  const targetAngle = bird.vy < 0 ? -0.35 : Math.min(1.35, (bird.vy / MAX_FALL_SPEED) * 1.5);
  bird.angle += (targetAngle - bird.angle) * Math.min(1, dt * 10);

  // Generación por distancia, no por tiempo.
  distanceSincePipe += speed * dt;
  if (pipes.length === 0 || distanceSincePipe >= PIPE_SPACING) {
    distanceSincePipe = 0;
    spawnPipe();
  }

  for (const p of pipes) {
    p.x -= speed * dt;
    if (!p.scored && p.x + PIPE_WIDTH < bird.x) {
      p.scored = true;
      score += 1;
      updateHud();
    }
  }
  // Elimina tubos fuera de pantalla.
  while (pipes.length > 0 && pipes[0].x + PIPE_WIDTH < -10) {
    pipes.shift();
  }

  // Techo: tope amable (sin muerte) para no castigar el flap alto.
  const halfH = BIRD_H / 2 - HITBOX_MARGIN;
  if (bird.y - halfH < 0) {
    bird.y = halfH;
    bird.vy = 0;
  }

  // Suelo: muerte.
  const groundTop = LOGICAL_HEIGHT - GROUND_HEIGHT;
  if (bird.y + halfH >= groundTop) {
    bird.y = groundTop - halfH;
    endGame();
    return;
  }

  // Colisión AABB con tubos (hitbox con perdón).
  const halfW = BIRD_W / 2 - HITBOX_MARGIN;
  const birdL = bird.x - halfW;
  const birdR = bird.x + halfW;
  const birdT = bird.y - halfH;
  const birdB = bird.y + halfH;
  for (const p of pipes) {
    const pipeL = p.x + PIPE_HITBOX_MARGIN;
    const pipeR = p.x + PIPE_WIDTH - PIPE_HITBOX_MARGIN;
    if (birdR <= pipeL || birdL >= pipeR) continue;
    const gapTop = p.gapY - p.gapH / 2;
    const gapBottom = p.gapY + p.gapH / 2;
    if (birdT < gapTop || birdB > gapBottom) {
      endGame();
      return;
    }
  }
}

// --- Dibujo procedural ---
function draw() {
  // Cielo con gradiente.
  const sky = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
  sky.addColorStop(0, '#4aa3df');
  sky.addColorStop(0.65, '#8fd0f0');
  sky.addColorStop(1, '#cdeccd');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  drawClouds();
  drawHills();
  drawPipes();
  drawGround();
  drawBird();

  if (state === STATE.PLAYING) drawScoreBig();
}

function drawClouds() {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const c of clouds) {
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 26 * c.s, 13 * c.s, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x - 18 * c.s, c.y + 5 * c.s, 16 * c.s, 10 * c.s, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x + 18 * c.s, c.y + 5 * c.s, 17 * c.s, 11 * c.s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHills() {
  const base = LOGICAL_HEIGHT - GROUND_HEIGHT;
  // Colina lejana (lenta) y cercana: dos tonos verdes propios.
  ctx.fillStyle = '#7fbf6a';
  ctx.beginPath();
  ctx.moveTo(0, base);
  for (let x = 0; x <= LOGICAL_WIDTH; x += 8) {
    const xx = x + hillX;
    ctx.lineTo(x, base - 46 - Math.sin(xx * 0.03) * 18);
  }
  ctx.lineTo(LOGICAL_WIDTH, base);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#5da24f';
  ctx.beginPath();
  ctx.moveTo(0, base);
  for (let x = 0; x <= LOGICAL_WIDTH; x += 8) {
    const xx = x + hillX * 1.6;
    ctx.lineTo(x, base - 22 - Math.abs(Math.sin(xx * 0.045)) * 22);
  }
  ctx.lineTo(LOGICAL_WIDTH, base);
  ctx.closePath();
  ctx.fill();
}

function drawPipes() {
  const groundTop = LOGICAL_HEIGHT - GROUND_HEIGHT;
  for (const p of pipes) {
    const gapTop = p.gapY - p.gapH / 2;
    const gapBottom = p.gapY + p.gapH / 2;
    pipeRect(p.x, 0, PIPE_WIDTH, gapTop, true);
    pipeRect(p.x, gapBottom, PIPE_WIDTH, groundTop - gapBottom, false);
  }
}

function pipeRect(x, y, w, h, isTop) {
  if (h <= 0) return;
  const LIP_H = 22;
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, '#3d8b3d');
  grad.addColorStop(0.5, '#69c24f');
  grad.addColorStop(1, '#2f6e2f');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#1e4d1e';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y - (isTop ? 3 : 0), w - 3, h + (isTop ? 3 : 0));

  // Labio del tubo junto al hueco.
  const lipY = isTop ? y + h - LIP_H : y;
  ctx.fillStyle = '#57a83e';
  ctx.fillRect(x - 3, lipY, w + 6, LIP_H);
  ctx.strokeRect(x - 3 + 1.5, lipY + 1.5, w + 6 - 3, LIP_H - 3);
}

function drawGround() {
  const top = LOGICAL_HEIGHT - GROUND_HEIGHT;
  ctx.fillStyle = '#d9b64f';
  ctx.fillRect(0, top, LOGICAL_WIDTH, GROUND_HEIGHT);
  ctx.fillStyle = '#8a6d2f';
  ctx.fillRect(0, top, LOGICAL_WIDTH, 6);
  // Franjas en movimiento para percibir la velocidad.
  ctx.fillStyle = '#c49b3f';
  for (let x = -groundX; x < LOGICAL_WIDTH; x += 48) {
    ctx.fillRect(x, top + 18, 24, GROUND_HEIGHT - 18);
  }
  // Puntitos decorativos.
  ctx.fillStyle = '#a8822f';
  for (let x = -groundX; x < LOGICAL_WIDTH; x += 24) {
    ctx.fillRect(x + 8, top + 44, 6, 6);
  }
}

function drawBird() {
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(bird.angle);

  // Cuerpo (elipse amarilla con barriga clara).
  ctx.fillStyle = '#ffcf3f';
  ctx.beginPath();
  ctx.ellipse(0, 0, BIRD_W / 2, BIRD_H / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a5a17';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.ellipse(2, 7, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ala animada: oscila con wingPhase.
  const flapSwing = Math.sin(bird.wingPhase) * 7;
  ctx.fillStyle = '#f39c2c';
  ctx.beginPath();
  ctx.ellipse(-6, 2 + flapSwing * 0.5, 11, 7 - flapSwing * 0.15, -0.5 + flapSwing * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a5a17';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Ojo.
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(7, -5, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(9, -5, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(10, -6, 1, 0, Math.PI * 2);
  ctx.fill();

  // Pico triangular.
  ctx.fillStyle = '#e8641b';
  ctx.beginPath();
  ctx.moveTo(14, -1);
  ctx.lineTo(24, 2);
  ctx.lineTo(14, 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8a3c0c';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawScoreBig() {
  ctx.save();
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(String(score), LOGICAL_WIDTH / 2, 56);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(score), LOGICAL_WIDTH / 2, 56);
  ctx.restore();
}

function updateHud() {
  hudScore.textContent = String(score);
  hudBest.textContent = String(best);
}

// --- Bucle principal con delta acotado ---
function frame(now) {
  if (!lastTime) lastTime = now;
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > MAX_DELTA) dt = MAX_DELTA; // pestaña en background: sin saltos
  if (dt < 0) dt = 0;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

// --- Entrada ---
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault(); // evita scroll con espacio
    if (!e.repeat) handlePress();
  }
});

// Click del ratón sobre el escenario.
stage.addEventListener('mousedown', (e) => {
  e.preventDefault();
  handlePress();
});

// Táctil: preventDefault para evitar scroll/zoom (salvo en el botón de
// reinicio: ahí suprimiría el click sintetizado y el juego no reiniciaría).
stage.addEventListener(
  'touchstart',
  (e) => {
    if (e.target instanceof Element && e.target.closest('#restart-btn')) return;
    e.preventDefault();
    handlePress();
  },
  { passive: false },
);

restartBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (state === STATE.GAME_OVER && !restartBtn.disabled) startGame();
});

window.addEventListener('resize', resize);

// --- Init ---
resize();
resetWorld();
state = STATE.READY;
overlayReady.classList.remove('hidden');
overlayGameOver.classList.add('hidden');
updateHud();
requestAnimationFrame(frame);
