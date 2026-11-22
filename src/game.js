"use strict";
{
/* ============================================================
   Utilidades
   ============================================================ */
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const PAL = ['#f68b1f', '#19b3d6', '#e5328a', '#ffd51c', '#7a3e97'];
const CRACK = '#3f1660';
const FINE = matchMedia('(hover:hover) and (pointer:fine)').matches;

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
const pad = (b, f) => ({ x: b.x - b.w * f, y: b.y - b.h * f, w: b.w * (1 + 2 * f), h: b.h * (1 + 2 * f) });
const union = (...bs) => { const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y)); return { x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y }; };

/* ============================================================
   Lectura y rasterizado de los SVG
   ============================================================ */
const SRC_MOD = {};
const SRC = name => SRC_MOD[name] || $('svg-' + name).textContent;
const parseSVG = name => new DOMParser().parseFromString(SRC(name), 'image/svg+xml').documentElement;
const byId = (root, id) => root.querySelector(`[id="${id}"]`);
const mbox = document.createElement('div');
mbox.style.cssText = 'position:absolute;left:-30000px;top:0;visibility:hidden;pointer-events:none';
document.body.appendChild(mbox);

// Serie de luces navideña: focos rojo, verde, amarillo y azul con cable oscuro
const XMAS = [['#ff7a7a', '#e3192b', '#8f0d17'], ['#7be08f', '#17a84a', '#0a5c27'], ['#fff3a0', '#ffcc12', '#c98a00'], ['#8ab8ff', '#1f63e0', '#0d3389']];
function prepLuces() {
  const svg = parseSVG('luces'), ns = svg.namespaceURI;
  let defs = svg.querySelector('defs');
  if (!defs) { defs = document.createElementNS(ns, 'defs'); svg.prepend(defs); }
  XMAS.forEach((c, i) => {
    const g = document.createElementNS(ns, 'linearGradient');
    g.setAttribute('id', 'xmas-' + i);
    [['x1', '.15'], ['y1', '0'], ['x2', '.85'], ['y2', '1']].forEach(([k, v]) => g.setAttribute(k, v));
    c.forEach((col, j) => { const st = document.createElementNS(ns, 'stop'); st.setAttribute('offset', [0, .45, 1][j]); st.setAttribute('stop-color', col); g.append(st); });
    defs.append(g);
  });
  const paint = (el, fill) => { el.removeAttribute('class'); el.setAttribute('fill', fill); };
  byId(svg, 'Cables-superiores').querySelectorAll('path').forEach(p => paint(p, '#17231c'));
  svg.querySelectorAll('[id^="Foco-"]').forEach((f, i) => {
    f.querySelectorAll('ellipse').forEach(e => e.remove());
    const [socket, bulb] = f.querySelectorAll('path');
    if (socket) paint(socket, '#26302a');
    if (bulb) paint(bulb, `url(#xmas-${i % XMAS.length})`);
  });
  SRC_MOD.luces = new XMLSerializer().serializeToString(svg);
}
// Mide grupos en coordenadas del viewBox del archivo
function measure(name, pick) {
  const svg = document.importNode(parseSVG(name), true);
  const vb = svg.viewBox.baseVal;
  svg.setAttribute('width', vb.width); svg.setAttribute('height', vb.height); svg.style.overflow = 'visible';
  mbox.appendChild(svg);
  const r0 = svg.getBoundingClientRect(), out = {};
  pick(svg).filter(Boolean).forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width && r.height) out[el.id] = { x: vb.x + r.left - r0.left, y: vb.y + r.top - r0.top, w: r.width, h: r.height };
  });
  mbox.removeChild(svg);
  return out;
}
// Deja solo los grupos indicados (y sus ancestros)
function isolate(root, keep) {
  const path = new Set();
  keep.forEach(e => { for (let n = e; n && n !== root; n = n.parentNode) path.add(n); });
  const walk = node => [...node.children].forEach(ch => {
    if (ch.localName === 'defs' || ch.localName === 'style' || keep.includes(ch)) return;
    if (path.has(ch)) walk(ch); else ch.remove();
  });
  walk(root);
}
function renderPart(name, box, scale, keepIds, hideIds) {
  const svg = parseSVG(name);
  if (keepIds) isolate(svg, keepIds.map(id => byId(svg, id)).filter(Boolean));
  (hideIds || []).forEach(id => { const e = byId(svg, id); if (e) e.remove(); });
  const pw = Math.max(1, Math.ceil(box.w * scale)), ph = Math.max(1, Math.ceil(box.h * scale));
  svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  svg.setAttribute('width', pw); svg.setAttribute('height', ph);
  svg.setAttribute('preserveAspectRatio', 'none');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const c = mkCanvas(pw, ph); c.getContext('2d').drawImage(img, 0, 0, pw, ph); URL.revokeObjectURL(url); res(c); };
    img.onerror = rej; img.src = url;
  });
}

/* ============================================================
   Medidas y recursos
   ============================================================ */
let W, H, DPR, S, cy0, py0, L0, maxOff;
let A = null;            // recursos rasterizados
let model = null;        // modelo de piñata activo
const glowCache = {};
function glow(color) {
  if (glowCache[color]) return glowCache[color];
  const s = 96, c = mkCanvas(s, s), g = c.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, color); gr.addColorStop(.3, color + '88'); gr.addColorStop(1, color + '00');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return (glowCache[color] = c);
}

async function buildBG() {
  const name = W / H > 1.05 ? 'horiz' : 'vert';
  const LIT = ['Ventana-izquierda', 'Ventana-pequena-izquierda', 'Ventana-pequena-derecha', 'Ventana-derecha', 'Farol-de-la-casa'];
  const m = measure(name, svg => [byId(svg, 'Cielo'), byId(svg, 'Suelo-azul'), ...svg.querySelectorAll('[id^="Estrella-"]'), ...LIT.map(i => byId(svg, i))]);
  const g = m['Suelo-azul'], sky = { x: g.x + 2, y: m.Cielo.y, w: g.w - 4, h: m.Cielo.h };
  const k = name === 'horiz' ? Math.max(W / sky.w, H / sky.h) : Math.max(W / sky.w, H * .86 / sky.h);
  const ox = W / 2 - (sky.x + sky.w / 2) * k, oy = H - (sky.y + sky.h) * k;
  const starIds = Object.keys(m).filter(i => i.startsWith('Estrella-'));
  const bg = await renderPart(name, { x: -ox / k, y: -oy / k, w: W / k, h: H / k }, k * DPR, null, starIds);
  const stars = await Promise.all(starIds.map(async id => {
    const b = pad(m[id], .2);
    return { img: await renderPart(name, b, k * DPR, [id]), x: ox + b.x * k, y: oy + b.y * k, w: b.w * k, h: b.h * k, p: rand(0, TAU), sp: rand(.8, 2.2) };
  }));
  const lights = LIT.filter(i => m[i]).map(i => ({ x: ox + (m[i].x + m[i].w / 2) * k, y: oy + (m[i].y + m[i].h / 2) * k, r: Math.max(m[i].w, m[i].h) * k * 1.3, p: rand(0, TAU) }));
  return { bg, stars, lights };
}

async function buildLights() {
  const m = measure('luces', svg => [byId(svg, 'Guirnaldas-superiores'), byId(svg, 'Focos-superiores'), ...svg.querySelectorAll('[id^="Foco-"]')]);
  const all = union(m['Guirnaldas-superiores'], m['Focos-superiores']);
  const wide = W / H > 1.05;
  const s = wide ? Math.min(W / all.w, H * .26 / all.h) : W / all.w * 1.04;
  const n = Math.max(1, Math.ceil(W / (all.w * s) - .05));
  const x0 = (W - n * all.w * s) / 2 - all.x * s, y0 = -all.y * s - (wide ? 0 : all.h * s * .05);
  const cb = pad(m['Guirnaldas-superiores'], .03);
  const cables = { img: await renderPart('luces', cb, s * DPR, ['Guirnaldas-superiores']), x: cb.x * s, y: cb.y * s, w: cb.w * s, h: cb.h * s };
  const ids = Object.keys(m).filter(i => i.startsWith('Foco-'));
  const bulbs = await Promise.all(ids.map(async (id, i) => {
    const b = pad(m[id], .08);
    const img = await renderPart('luces', b, s * DPR, [id]);
    const off = mkCanvas(img.width, img.height), g = off.getContext('2d');
    g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(14,18,58,.6)'; g.fillRect(0, 0, off.width, off.height);
    return { img, off, color: XMAS[i % XMAS.length][1], x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s, i, ph: rand(0, TAU) };
  }));
  return { cables, bulbs, n, x0, y0, tw: all.w * s };
}

const MODELS = {
  entera: {
    file: 'entera', root: ['Pinata'], body: ['Silueta-del-cuerpo'], hang: 'Asa-y-tapa', picos: 'Siete-picos',
    tassels: [['Pico-superior-izquierdo-papel', 'Pico-superior-izquierdo-listones'], ['Pico-superior-derecho-papel', 'Pico-superior-derecho-listones'],
      ['Pico-horizontal-izquierdo-papel', 'Pico-horizontal-izquierdo-listones'], ['Pico-horizontal-derecho-papel', 'Pico-horizontal-derecho-listones'],
      ['Pico-diagonal-izquierdo-papel', 'Pico-diagonal-izquierdo-listones'], ['Pico-diagonal-derecho-papel', 'Pico-diagonal-derecho-listones'],
      ['Pico-inferior-papel', 'Pico-inferior-listones']]
  },
  rota: {
    file: 'rota2', root: ['Colgante', 'Picos-visibles', 'Interior-y-papel-rasgado', 'Costado-derecho1'], piece: 'Costado-derecho1',
    body: ['Silueta-izquierda', 'Silueta-derecha', 'Silueta-derecha1'], hang: 'Colgante', picos: 'Picos-visibles',
    tassels: [['Sup-Izq-Papel', 'Sup-Izq-Listones'], ['Sup-Der-Papel', 'Sup-Der-Listones'], ['Med-Izq-Papel', 'Med-Izq-Listones'],
      ['Med-Der-Papel', 'Med-Der-Listones'], ['Inf-Der-Papel', 'Inf-Der-Listones']]
  }
};
async function buildModel(cfg, sizer) {
  const ids = [...cfg.root, ...cfg.body, cfg.hang, cfg.picos, ...cfg.tassels.flat(), cfg.piece].filter(Boolean);
  const m = measure(cfg.file, svg => ids.map(i => byId(svg, i)));
  const k = sizer(m);
  const body = union(...cfg.body.map(i => m[i]));
  const bc = { x: body.x + body.w / 2, y: body.y + body.h / 2 };
  const L = (x, y) => ({ x: (x - bc.x) * k, y: (y - bc.y) * k });
  const sc = k * DPR;
  const listIds = cfg.tassels.map(t => t[1]);
  const root = union(...cfg.root.map(i => m[i])), rb = pad(root, .02);
  const place = b => ({ ...L(b.x, b.y), w: b.w * k, h: b.h * k });
  const out = { R: Math.min(body.w, body.h) / 2 * k, halfW: root.w / 2 * k, picosW: m[cfg.picos].w * k };
  out.hitR = out.halfW * .8;
  out.body = { img: await renderPart(cfg.file, rb, sc, cfg.root, listIds), ...place(rb) };
  const hb = m[cfg.hang];
  out.attach = L(hb.x + hb.w / 2, hb.y + hb.h * .2);
  out.wrap = { ...L(hb.x + hb.w / 2, hb.y + hb.h * .03), w: hb.w * k * .2 };
  out.tassels = [];
  for (const [pid, lid] of cfg.tassels) {
    const pb = m[pid], lb = m[lid]; if (!pb || !lb) continue;
    const corners = [[pb.x, pb.y], [pb.x + pb.w, pb.y], [pb.x, pb.y + pb.h], [pb.x + pb.w, pb.y + pb.h]];
    const tip = corners.sort((a, b) => Math.hypot(b[0] - bc.x, b[1] - bc.y) - Math.hypot(a[0] - bc.x, a[1] - bc.y))[0];
    const pv = L(clamp(tip[0], lb.x, lb.x + lb.w), clamp(tip[1], lb.y, lb.y + lb.h));
    const b = pad(lb, .04);
    out.tassels.push({ img: await renderPart(cfg.file, b, sc, [lid]), pivot: pv, ...place(b) });
  }
  if (cfg.piece) {
    const b = pad(m[cfg.piece], .04);
    out.piece = { img: await renderPart(cfg.file, b, sc, [cfg.piece]), ...L(b.x + b.w / 2, b.y + b.h / 2), w: b.w * k, h: b.h * k };
  }
  return out;
}
// Papeles sueltos (del primer archivo de piñata rota)
async function buildPapers(picosW) {
  const m = measure('rota', svg => [byId(svg, 'Picos-visibles'), byId(svg, 'Silueta-izquierda'), byId(svg, 'Silueta-derecha'), ...svg.querySelectorAll('[id="Papel-en-el-aire"] > g')]);
  const k = picosW / m['Picos-visibles'].w;
  const body = union(m['Silueta-izquierda'], m['Silueta-derecha']), cx = body.x + body.w / 2, cy = body.y + body.h / 2;
  const ids = Object.keys(m).filter(i => i.startsWith('Papel-') || i.startsWith('Solapa-'));
  return Promise.all(ids.map(async id => {
    const b = pad(m[id], .05);
    return { img: await renderPart('rota', b, k * DPR, [id]), x: (b.x + b.w / 2 - cx) * k, y: (b.y + b.h / 2 - cy) * k, w: b.w * k, h: b.h * k };
  }));
}

const TSCALE = { Mandarina: 1, Tejocote: .86, Cana: 1.15, Cacahuate: .88, Colacion: .62 };
const TWEIGHT = { Mandarina: 4, Tejocote: 4, Cana: 3, Cacahuate: 3, Colacion: 4 };
const HITTERS = ['Mandarina', 'Cana', 'Tejocote', 'Cacahuate', 'Colacion'];
const HSCALE = { Mandarina: 1, Tejocote: .9, Cana: 1.05, Cacahuate: .95, Colacion: .82 };
const WORD_ID = { Mandarina: 'w-Alegria', Cana: 'w-Abundancia', Tejocote: 'w-Salud', Cacahuate: 'w-Amistad', Colacion: 'w-Amor' };
// Cada deseo se dibuja con el vector del letrero, ya colocado donde quedará en el mensaje final
async function buildWords() {
  const el = $('final').querySelector('.words-svg'), vb = el.viewBox.baseVal, rc = el.getBoundingClientRect();
  const sc = rc.width / vb.width;
  const ids = Object.values(WORD_ID), m = measure('letras', svg => ids.map(i => byId(svg, i)));
  const out = {};
  await Promise.all(Object.entries(WORD_ID).map(async ([type, id]) => {
    const b = pad(m[id], .04);
    out[type] = { img: await renderPart('letras', b, sc * DPR * 1.5, [id]), x: rc.left + (b.x - vb.x) * sc, y: rc.top + (b.y - vb.y) * sc, w: b.w * sc, h: b.h * sc };
  }));
  return out;
}
async function buildFruits() {
  const m = measure('frutas', svg => [...svg.querySelectorAll('[id="Frutas-canas-cacahuates-y-colacion"] > g > g')]);
  const px = Math.min(460, S * .34 * DPR);
  const out = {};
  await Promise.all(Object.keys(m).map(async id => {
    const type = id.split('-')[0]; if (!TSCALE[type]) return;
    const b = pad(m[id], .03), long = Math.max(b.w, b.h);
    const img = await renderPart('frutas', b, px / long, [id]);
    (out[type] = out[type] || []).push({ img, aspect: b.w / b.h });
  }));
  return out;
}
const pickVariant = type => { const v = A.fruits[type]; return v[Math.floor(Math.random() * v.length)]; };
function pickType() {
  const tot = Object.values(TWEIGHT).reduce((a, b) => a + b, 0); let r = Math.random() * tot;
  for (const t in TWEIGHT) { r -= TWEIGHT[t]; if (r <= 0) return t; } return 'Mandarina';
}

let buildToken = 0;
async function rebuild() {
  const tok = ++buildToken;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  W = w; H = h; S = Math.min(W, H * .62);
  const [bg, lights, wordSprites, entera, fruits] = await Promise.all([
    buildBG(), buildLights(), buildWords(),
    buildModel(MODELS.entera, m => S * .82 / m.Pinata.w),
    buildFruits()
  ]);
  const [rota, papers] = await Promise.all([
    buildModel(MODELS.rota, m => entera.picosW / m['Picos-visibles'].w),
    buildPapers(entera.picosW)
  ]);
  if (tok !== buildToken) return;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  A = { bg, lights, entera, rota, papers, fruits, words: wordSprites };
  cy0 = H * .43; py0 = -S * .06;
  L0 = Math.max(S * .22, cy0 - py0 + entera.attach.y);
  maxOff = Math.max(S * .06, W / 2 - entera.halfW * .95);
  if (model) { model = hits >= 6 ? A.rota : A.entera; resetTassels(); }
  else start();
}
function start() {
  reset(); document.body.classList.add('ready');
  requestAnimationFrame(t => { last = t; frame(t); });
}

/* ============================================================
   Dibujo del escenario
   ============================================================ */
function drawScene(t) {
  ctx.fillStyle = '#1e2447'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(A.bg.bg, 0, 0, W, H);
  A.bg.stars.forEach(s => {
    const a = .45 + .55 * (.5 + .5 * Math.sin(t * s.sp + s.p)), sc = .85 + .25 * a;
    ctx.globalAlpha = a;
    ctx.drawImage(s.img, s.x + s.w * (1 - sc) / 2, s.y + s.h * (1 - sc) / 2, s.w * sc, s.h * sc);
  });
  ctx.globalAlpha = 1;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  A.bg.lights.forEach(l => {
    ctx.globalAlpha = .22 + .08 * Math.sin(t * 2.1 + l.p) + .04 * Math.sin(t * 7.3 + l.p * 2);
    ctx.drawImage(glow('#ffc04d'), l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  });
  ctx.restore();
}
function drawLights(t) {
  const L = A.lights, mode = Math.floor(t / 6) % 3;
  for (let k = 0; k < L.n; k++) {
    const ox = L.x0 + k * L.tw, oy = L.y0;
    ctx.drawImage(L.cables.img, ox + L.cables.x, oy + L.cables.y, L.cables.w, L.cables.h);
    L.bulbs.forEach(b => {
      const idx = b.i + k * L.bulbs.length;
      let on;
      if (mode === 0) on = .5 + .5 * Math.sin(t * 2.4 + b.ph + k);
      else if (mode === 1) on = ((Math.floor(t * 3) + idx) % 3 === 0) ? 1 : .1;
      else on = .5 + .5 * Math.sin(t * 3 - idx * .5);
      on = on * on * (3 - 2 * on);
      const x = ox + b.x, y = oy + b.y;
      ctx.drawImage(b.off, x, y, b.w, b.h);
      ctx.globalAlpha = on; ctx.drawImage(b.img, x, y, b.w, b.h); ctx.globalAlpha = 1;
      if (on > .08) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = on * .32;
        const gs = Math.max(b.w, b.h) * 2;
        ctx.drawImage(glow(b.color), x + b.w / 2 - gs / 2, y + b.h * .6 - gs / 2, gs, gs); ctx.restore();
      }
    });
  }
}

/* ============================================================
   Audio generado (Web Audio)
   ============================================================ */
let AC = null, master = null, muted = false, noiseBuf, crackBuf;
function initAudio() {
  if (AC) { if (AC.state !== 'running') AC.resume(); return; }
  const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { }
  AC = new C();
  master = AC.createGain(); master.gain.value = muted ? 0 : 1;
  const comp = AC.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 4;
  master.connect(comp); comp.connect(AC.destination);
  const len = AC.sampleRate;
  noiseBuf = AC.createBuffer(1, len, AC.sampleRate); crackBuf = AC.createBuffer(1, len, AC.sampleRate);
  const n = noiseBuf.getChannelData(0), k = crackBuf.getChannelData(0);
  for (let i = 0; i < len; i++) { n[i] = Math.random() * 2 - 1; k[i] = Math.random() < .045 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * .08; }
  const b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0);
  loadMusic();
}
/* ---------- canción de la piñata y porra ---------- */
const MUSIC = { cancion: null, porra: null, jingle: null, src: null, gain: null, want: false, jsrc: null, jgain: null };
function loadMusic() {
  ['cancion', 'porra', 'jingle'].forEach(key => {
    const bin = Uint8Array.from(atob($('aud-' + key).textContent.trim()), c => c.charCodeAt(0));
    AC.decodeAudioData(bin.buffer, buf => { MUSIC[key] = buf; if (key === 'cancion' && MUSIC.want) startSong(); }, () => { });
  });
}
function startSong() {
  MUSIC.want = true;
  if (!AC || !MUSIC.cancion || MUSIC.src) return;
  const src = AC.createBufferSource(), g = AC.createGain(), t = AC.currentTime;
  src.buffer = MUSIC.cancion; src.loop = true;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.55, t + .4);
  src.connect(g); g.connect(master); src.start(t);
  MUSIC.src = src; MUSIC.gain = g;
}
function stopSong(fade = 1.8) {
  MUSIC.want = false;
  if (!MUSIC.src) return;
  const t = AC.currentTime, g = MUSIC.gain.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
  MUSIC.src.stop(t + fade + .05); MUSIC.src = null;
}
// Jingle del letrero final: suena una vez y se desvanece al terminar
function playJingle() {
  if (!MUSIC.jingle) return;
  stopJingle(0);
  const src = AC.createBufferSource(), g = AC.createGain(), t = AC.currentTime, off = .2, end = t + MUSIC.jingle.duration - off;
  src.buffer = MUSIC.jingle;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.6, t + 2);
  g.gain.setValueAtTime(.6, end - 3.5); g.gain.linearRampToValueAtTime(0, end);
  src.connect(g); g.connect(master); src.start(t, off);
  MUSIC.jsrc = src; MUSIC.jgain = g;
}
function stopJingle(fade = .4) {
  if (!MUSIC.jsrc) return;
  const t = AC.currentTime, g = MUSIC.jgain.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
  MUSIC.jsrc.stop(t + fade + .05); MUSIC.jsrc = null;
}
function playCheer() {
  if (!MUSIC.porra) return;
  const src = AC.createBufferSource(), g = AC.createGain();
  src.buffer = MUSIC.porra; g.gain.value = .9;
  src.connect(g); g.connect(master); src.start(AC.currentTime + .15);
}
function tone(type, f0, f1, dur, vol, t0 = 0) {
  if (!AC) return; const t = AC.currentTime + t0;
  const o = AC.createOscillator(), g = AC.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .006); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .03);
}
function noise(buf, dur, vol, type, f0, f1, Q, t0 = 0) {
  if (!AC) return; const t = AC.currentTime + t0;
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = buf; f.type = type; f.Q.value = Q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * .5); s.stop(t + dur + .05);
}
const SFX = {
  hit(k) {
    tone('sine', 150 - k * 6, 40, .3, .95);
    tone('triangle', 280, 90, .12, .35);
    noise(noiseBuf, .1, .55, 'lowpass', 1100, 300, .7);
    noise(crackBuf, .3 + k * .03, .7, 'bandpass', 2800, 1600, .8, .01);
    noise(crackBuf, .18, .35, 'highpass', 5000, 4000, .5, .02);
  },
  miss() { noise(noiseBuf, .22, .22, 'bandpass', 500, 2600, 1.5); },
  rise() { noise(noiseBuf, .55, .12, 'bandpass', 380, 1500, 2); },
  boom() {
    tone('sine', 120, 28, 1.0, 1);
    tone('triangle', 200, 50, .4, .4);
    noise(noiseBuf, .9, .9, 'lowpass', 1800, 120, .6);
    noise(crackBuf, .8, .9, 'bandpass', 3200, 1400, .7, .02);
    [1318, 1568, 2093, 2637, 3136].forEach((f, i) => tone('sine', f, f * .98, .5, .14, .25 + i * .09));
  },
  thunk() { tone('sine', 300, 90, .14, .5); noise(noiseBuf, .05, .3, 'bandpass', 1600, 900, 1); },
  pop(v) { v = clamp(v, .15, 1); tone('sine', rand(520, 820), 170, .1, .6 * v); noise(noiseBuf, .025, .25 * v, 'highpass', 3000, 2500, .7); },
  boing() { tone('sine', 220, 620, .16, .5); tone('triangle', 440, 900, .12, .2, .04); },
  collect() { [784, 988, 1319, 1568].forEach((f, i) => tone('triangle', f, f, .18, .32, i * .06)); tone('sine', 2637, 2600, .4, .1, .22); },
  test() { [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, .22, .4, i * .1)); setTimeout(() => SFX.pop(1), 460); }
};
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { } }

/* ============================================================
   Estado del juego
   ============================================================ */
const P = {};
let state, hits, cracks, holes, confetti, items, flashes, rays, stick, tassels, shake, wshake, riseTimer, holdTimer, hintTimer, hintShown, words, collected, finalTimer;
const mouse = { x: -999, y: -999, in: false };

function reset() {
  Object.assign(P, { px: W / 2, pvx: 0, ax: 0, th: .12, om: 0, phi: 0, phiV: 0, escape: 0, lift: H * 1.1, liftV: 0, liftTarget: 0, ay: 0, py: 0, time: 0, L: L0 });
  state = 'intro'; hits = 0; cracks = []; holes = []; confetti = []; items = []; flashes = []; rays = null; stick = null;
  model = A.entera; resetTassels();
  shake = 0; wshake = 0; riseTimer = -1; holdTimer = -1; hintTimer = 0; hintShown = false; words = []; collected = 0; finalTimer = -1;
  $('final').classList.remove('show');
  $('hint').classList.remove('show', 'hide');
}
const resetTassels = () => { tassels = model.tassels.map(() => ({ a: 0, v: 0, px: null, py: null, vx: 0, vy: 0 })); };

/* ---------- péndulo ---------- */
function updatePendulum(dt) {
  const sp = 1 + hits * .24;
  P.time += dt * sp;
  const A_ = maxOff * .5 * Math.min(1.7, 1 + hits * .13);
  P.escape *= Math.exp(-dt * .35);
  const tx = clamp(W / 2 + P.escape + Math.sin(P.time * 1.9) * A_, W / 2 - maxOff, W / 2 + maxOff);
  const k = 7 + hits * 1.5, c = 2 * Math.sqrt(k) * .9;
  P.ax = k * (tx - P.px) - c * P.pvx; P.pvx += P.ax * dt; P.px += P.pvx * dt;
  const lk = 26, lc = 2 * Math.sqrt(lk) * .62;
  const la = lk * (P.liftTarget - P.lift) - lc * P.liftV;
  P.liftV += la * dt; P.lift += P.liftV * dt;
  const bobA = S * .03, bobW = 1.3;
  P.py = py0 - P.lift + Math.sin(P.time * bobW) * bobA;
  P.ay = -la - Math.sin(P.time * bobW) * bobA * bobW * bobW * sp * sp;
  P.L = L0;
  const g = L0 * 9.87 * (1 + hits * .1);
  const ay = clamp(P.ay, -g * .6, g * .6);
  const steps = 4, h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const acc = -(g + ay) * Math.sin(P.th) / P.L - .45 * P.ax * Math.cos(P.th) / P.L - 1.5 * P.om;
    P.om += acc * h; P.th += P.om * h;
  }
  const lim = .42;
  if (Math.abs(P.th) > lim) { P.th = Math.sign(P.th) * (lim + (Math.abs(P.th) - lim) * .5); P.om *= .7; }
  const pa = -40 * P.phi - 5 * P.phiV - P.om * 2.2;
  P.phiV += pa * dt; P.phi += P.phiV * dt;
  shake *= Math.exp(-dt * 7);
}
function pinFrame() {
  const ex = P.px + P.L * Math.sin(P.th), ey = P.py + P.L * Math.cos(P.th);
  const rot = -(P.th + P.phi), now = performance.now();
  const a = model.attach, c = Math.cos(rot), s = Math.sin(rot);
  const jx = Math.sin(now * .06) * model.R * .08 * shake, jy = Math.cos(now * .071) * model.R * .05 * shake;
  return { ex, ey, rot, cx: ex - (a.x * c - a.y * s) + jx, cy: ey - (a.x * s + a.y * c) + jy };
}
const toWorld = (f, lx, ly) => ({ x: f.cx + lx * Math.cos(f.rot) - ly * Math.sin(f.rot), y: f.cy + lx * Math.sin(f.rot) + ly * Math.cos(f.rot) });
const toLocal = (f, x, y) => { const dx = x - f.cx, dy = y - f.cy; return { x: dx * Math.cos(-f.rot) - dy * Math.sin(-f.rot), y: dx * Math.sin(-f.rot) + dy * Math.cos(-f.rot) }; };

/* ---------- cuerda de mecate ---------- */
function ropeStroke(pts, w) {
  const path = () => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  path(); ctx.strokeStyle = '#4a2f16'; ctx.lineWidth = w + Math.max(2.5, w * .3); ctx.stroke();
  path(); ctx.strokeStyle = '#d5ab6f'; ctx.lineWidth = w; ctx.stroke();
  ctx.save(); ctx.translate(-w * .18, -w * .1); path(); ctx.strokeStyle = 'rgba(255,236,190,.55)'; ctx.lineWidth = w * .22; ctx.stroke(); ctx.restore();
  ctx.strokeStyle = 'rgba(90,55,20,.75)'; ctx.lineWidth = Math.max(1.2, w * .16); ctx.lineCap = 'butt';
  let acc = 0; const step = w * .75, c = Math.cos(.9), s = Math.sin(.9);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], seg = Math.hypot(b.x - a.x, b.y - a.y); if (!seg) continue;
    const ux = (b.x - a.x) / seg, uy = (b.y - a.y) / seg, dx = ux * c - uy * s, dy = ux * s + uy * c;
    while (acc < seg) {
      const x = a.x + ux * acc, y = a.y + uy * acc;
      ctx.beginPath(); ctx.moveTo(x - dx * w * .5, y - dy * w * .5); ctx.lineTo(x + dx * w * .5, y + dy * w * .5); ctx.stroke();
      acc += step;
    }
    acc -= seg;
  }
}
const ropeW = () => Math.max(5, S * .022);
function drawRope(f) {
  const top = { x: P.px, y: P.py - 40 }, end = { x: f.ex, y: f.ey };
  const mx = (top.x + end.x) / 2 + clamp(-P.om * S * .03, -S * .05, S * .05), my = (top.y + end.y) / 2;
  const pts = [];
  for (let i = 0; i <= 30; i++) { const t = i / 30; pts.push({ x: (1 - t) * (1 - t) * top.x + 2 * t * (1 - t) * mx + t * t * end.x, y: (1 - t) * (1 - t) * top.y + 2 * t * (1 - t) * my + t * t * end.y }); }
  ropeStroke(pts, ropeW());
}
function drawWraps(f) {
  const w = ropeW(), wr = model.wrap;
  ctx.save(); ctx.translate(f.cx, f.cy); ctx.rotate(f.rot);
  for (let i = 0; i < 3; i++) {
    const y = wr.y - w * .9 + i * w * .7;
    ropeStroke([{ x: wr.x - wr.w / 2, y }, { x: wr.x + wr.w / 2, y: y + w * .2 }], w * .75);
  }
  ctx.restore();
}

/* ---------- piñata y listones ---------- */
function drawImg(o, img) { ctx.drawImage(img || o.img, o.x, o.y, o.w, o.h); }
function drawPinata(f) {
  ctx.save(); ctx.translate(f.cx, f.cy); ctx.rotate(f.rot); drawImg(model.body); ctx.restore();
}
function updateTassels(f, dt) {
  model.tassels.forEach((tz, i) => {
    const T = tassels[i], tip = toWorld(f, tz.pivot.x, tz.pivot.y);
    if (T.px !== null && dt > 0) { T.vx += ((tip.x - T.px) / dt - T.vx) * .3; T.vy += ((tip.y - T.py) / dt - T.vy) * .3; }
    T.px = tip.x; T.py = tip.y;
    const target = clamp(T.vx / (S * 2.4), -.9, .9);
    T.v += (70 * (target - T.a) - 7 * T.v) * dt; T.a += T.v * dt;
  });
}
function drawTassels(f, t) {
  model.tassels.forEach((tz, i) => {
    const T = tassels[i], speed = Math.min(1.5, Math.hypot(T.vx, T.vy) / S);
    const r = clamp(-f.rot * .85 + T.a + Math.sin(t * 5.5 + i * 1.7) * (.05 + speed * .12), -1.1, 1.1);
    ctx.save(); ctx.translate(f.cx, f.cy); ctx.rotate(f.rot); ctx.translate(tz.pivot.x, tz.pivot.y); ctx.rotate(r);
    ctx.drawImage(tz.img, tz.x - tz.pivot.x, tz.y - tz.pivot.y, tz.w, tz.h);
    ctx.restore();
  });
}

/* ---------- grietas ---------- */
function addCrack(localAng) {
  const R = model.R, a = localAng + rand(-.25, .25);
  let p = { x: Math.cos(a) * R * 1.02, y: Math.sin(a) * R * 1.02 }; const pts = [p];
  let dir = a + Math.PI + rand(-.35, .35);
  const segs = 4 + hits, seg = R * (.1 + .012 * hits);
  for (let i = 0; i < segs; i++) { dir += rand(-.55, .55); p = { x: p.x + Math.cos(dir) * seg, y: p.y + Math.sin(dir) * seg }; pts.push(p); }
  const cr = { pts, w: 1, br: [] };
  for (let b = 0; b < 2; b++) {
    let q = { ...pts[1 + Math.floor(Math.random() * (pts.length - 2))] }; const bp = [q]; let d2 = dir + rand(-1.6, 1.6);
    for (let i = 0; i < 3; i++) { d2 += rand(-.5, .5); q = { x: q.x + Math.cos(d2) * seg * .8, y: q.y + Math.sin(d2) * seg * .8 }; bp.push(q); }
    cr.br.push(bp);
  }
  cracks.forEach(c => c.w = Math.min(3, c.w + .45));
  cracks.push(cr);
  if (hits >= 4) {
    const hr = R * (.15 + .06 * (hits - 4)), hc = { x: Math.cos(a) * R * .6, y: Math.sin(a) * R * .6 }, poly = [];
    for (let i = 0; i < 11; i++) { const t = i / 11 * TAU, rr = hr * (i % 2 ? .55 : 1) * rand(.8, 1.15); poly.push({ x: hc.x + Math.cos(t) * rr, y: hc.y + Math.sin(t) * rr }); }
    holes.push({ poly, c: hc, r: hr, fruit: pickVariant('Mandarina') });
  }
}
function drawCracks(f) {
  if (!cracks.length || model !== A.entera) return;
  const R = model.R;
  ctx.save(); ctx.translate(f.cx, f.cy); ctx.rotate(f.rot);
  ctx.beginPath(); ctx.arc(0, 0, R * .97, 0, TAU); ctx.clip();
  holes.forEach(h => {
    ctx.beginPath(); h.poly.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
    ctx.fillStyle = '#2c0d47'; ctx.fill();
    ctx.save(); ctx.clip(); const s = h.r * 1.6; ctx.drawImage(h.fruit.img, h.c.x - s * .25, h.c.y - s * .15, s, s / h.fruit.aspect); ctx.restore();
    ctx.strokeStyle = '#7a3e97'; ctx.lineWidth = R * .04; ctx.stroke();
  });
  const line = (pts, w) => {
    ctx.lineJoin = 'miter'; ctx.lineCap = 'round';
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.save(); ctx.translate(R * .015, R * .015); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = w * .45; ctx.stroke(); ctx.restore();
    ctx.strokeStyle = CRACK; ctx.lineWidth = w; ctx.stroke();
  };
  cracks.forEach(c => { line(c.pts, R * .035 * c.w); c.br.forEach(b => line(b, R * .022 * c.w)); });
  ctx.restore();
}

/* ---------- papelitos (rectángulos y piezas del SVG) ---------- */
function spawnConfetti(x, y, n, power) {
  const u = model ? model.R : S * .1;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(.2, 1) * power;
    confetti.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * .35, rot: rand(0, TAU), vr: rand(-8, 8),
      w: u * rand(.07, .12), h: u * rand(.1, .18),
      c: PAL[Math.floor(Math.random() * PAL.length)], flip: rand(0, TAU), fs: rand(6, 14), life: rand(2.2, 3.4), age: 0
    });
  }
}
function spawnPieces(f, list, power) {
  list.forEach(pc => {
    const p = toWorld(f, pc.x, pc.y), dx = p.x - f.cx, dy = p.y - f.cy, d = Math.hypot(dx, dy) || 1;
    const v = rand(.5, 1) * power;
    confetti.push({ img: pc.img, x: p.x, y: p.y, w: pc.w, h: pc.h, vx: dx / d * v, vy: dy / d * v - power * .3, rot: f.rot, vr: rand(-5, 5), flip: 0, fs: rand(2, 5), life: rand(2.6, 3.6), age: 0 });
  });
}
function updateConfetti(dt) {
  confetti.forEach(p => {
    p.age += dt;
    if (p.solid) { p.vy += H * 1.4 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; return; } p.vy += H * .9 * dt; p.vx *= Math.exp(-dt * 1.6); p.vy *= Math.exp(-dt * 1.6);
    p.x += (p.vx + Math.sin(p.age * 4 + p.flip) * S * .05) * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.flip += p.fs * dt;
  });
  confetti = confetti.filter(p => p.age < p.life && p.y < H + 80 + (p.h || 0) && Math.abs(p.x - W / 2) < W / 2 + 40 + (p.w || 0));
}
function drawConfetti() {
  confetti.forEach(p => {
    ctx.save(); ctx.globalAlpha = p.solid ? 1 : clamp((p.life - p.age) / .5, 0, 1);
    ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(p.mx || 1, Math.cos(p.flip));
    if (p.img) ctx.drawImage(p.img, -p.w / 2, -p.h / 2, p.w, p.h);
    else { ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
    ctx.restore();
  });
}

/* ---------- palo ---------- */
function drawStick(x, y, ang, alpha) {
  const len = S * .85, w = Math.max(9, S * .038);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.roundRect(-w / 2, 0, w, len, w / 2);
  ctx.fillStyle = '#f2dcb2'; ctx.fill();
  ctx.save(); ctx.clip();
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 ? '#e5328a' : '#19b3d6';
    ctx.beginPath(); const yy = i * w * 1.6; ctx.moveTo(-w, yy); ctx.lineTo(w, yy - w * .7); ctx.lineTo(w, yy - w * .2); ctx.lineTo(-w, yy + w * .5); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-w * .35, 0, w * .2, len);
  ctx.restore();
  ctx.strokeStyle = '#2a1a4a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.roundRect(-w / 2, 0, w, len, w / 2); ctx.stroke();
  ctx.restore();
}
const stickBaseAngle = (x, y) => Math.atan2(H * 1.15 - y, W * .5 + (x < W / 2 ? 1 : -1) * W * .35 - x) - Math.PI / 2;

/* ---------- golpes ---------- */
function onDown(e) {
  e.preventDefault();
  initAudio();
  if (state === 'intro' || state === 'play') startSong();
  if (!A) return;
  const x = e.clientX, y = e.clientY;
  if (state === 'broken') { tryCollect(x, y); return; }
  if (state !== 'intro' && state !== 'play') return;
  stick = { x, y, t: 0 };
  hideHint();
  const f = pinFrame(), lp = toLocal(f, x, y);
  if (Math.hypot(lp.x, lp.y) < model.hitR) doHit(x, y, f, lp); else SFX.miss();
}
function doHit(x, y, f, lp) {
  hits++; state = 'play'; hideHint();
  if (hits >= 7) { breakPinata(f); return; }
  SFX.hit(hits); vibrate([40, 25, 30]);
  shake = 1;
  P.phiV += (lp.x > 0 ? -1 : 1) * rand(3, 5);
  const dir = Math.random() < .5 ? -1 : 1;
  P.om += dir * (.55 + hits * .06);
  P.escape = dir * rand(.6, 1) * maxOff;
  const d = Math.hypot(lp.x, lp.y) || 1, R = model.R;
  const hp = d > R ? toWorld(f, lp.x / d * R * .9, lp.y / d * R * .9) : { x, y };
  if (hits === 6) {
    // ya casi se rompe: cambia a la piñata rota
    model = A.rota; resetTassels(); wshake = .5;
    const f2 = pinFrame();
    spawnPieces(f2, A.papers.filter((_, i) => i % 3 === 0), S * .9);
    spawnConfetti(f2.cx, f2.cy, 30, S * 1.1);
    dropFruits(f2, 3 + (Math.random() < .5 ? 1 : 0));
  } else {
    addCrack(Math.atan2(lp.y, lp.x));
    spawnConfetti(hp.x, hp.y, 14 + hits * 3, S * .9);
  }
  flashes.push({ x: hp.x, y: hp.y, t: 0 });
  if (hits >= 2 && hits <= 6) riseTimer = .22;
}

/* ---------- ruptura ---------- */
function breakPinata(f) {
  state = 'broken';
  SFX.boom(); vibrate([90, 40, 180]);
  stopSong(); playCheer();
  wshake = 1;
  const C = { x: f.cx, y: f.cy }, R = A.rota.R;
  rays = { x: C.x, y: C.y, t: 0 };
  flashes.push({ x: C.x, y: C.y, t: 0, big: true });
  // la piñata desaparece en el estallido: salen papelitos, el contenido y dos trozos (uno reflejado)
  spawnConfetti(C.x, C.y, 70, S * 1.8);
  const pc = A.rota.piece;
  // cuatro trozos: dos hacia los lados y dos hacia arriba (uno de cada par reflejado)
  [[1, 1.45, .65], [-1, 1.45, .65], [1, .75, 2.4], [-1, .75, 2.4]].forEach(([mx, vx, vy]) => {
    const p = toWorld(f, pc.x * mx, pc.y);
    // gira como ruleta sobre su centro y sale rápido de cuadro
    confetti.push({ img: pc.img, solid: true, mx, x: p.x, y: p.y, w: pc.w * 1.15, h: pc.h * 1.15, vx: mx * S * vx * rand(.9, 1.1), vy: -S * vy * rand(.95, 1.05),
      rot: f.rot + rand(-.6, .6), vr: mx * rand(9, 11), flip: 0, fs: 0, life: 3, age: 0 });
  });
  // contenido que sale disparado
  const Z0 = 6, s0 = S * .085;
  for (let i = 0; i < 30; i++) {
    const type = pickType(), a = rand(0, TAU), lat = S * (Math.random() < .5 ? rand(.04, .16) : rand(.2, .45));
    items.push({ type, v: pickVariant(type), mode: 'fly', hit: false, d: rand(0, .22), t: 0, Z0, z: Z0, vz: rand(2.6, 4), dx: Math.cos(a) * lat, dy: Math.sin(a) * lat, gy: S * .25,
      ox: rand(-R * .3, R * .3), oy: rand(-R * .3, R * .3), C, s0, rot: rand(0, TAU), vr: rand(-3, 3), alpha: 1 });
  }
  // las 8 que pegan en la pantalla
  const margin = Math.max(18, W * .07), slot = Math.min((W - margin * 2) / HITTERS.length, S * .42), slot0 = (W - slot * HITTERS.length) / 2;
  const sHit = Math.min(S * .27, slot * .84);
  const hitters = HITTERS.map((type, i) => {
    const a = i / HITTERS.length * TAU + rand(-.25, .25) + .3;
    return { type, Tx: clamp(C.x + Math.cos(a) * W * .34, W * .14, W * .86), Ty: clamp(C.y + Math.sin(a) * H * .26, H * .14, H * .7) };
  }).sort((p, q) => p.Tx - q.Tx);
  hitters.forEach(({ type, Tx, Ty }, i) => {
    const zHit = Z0 * s0 / sHit, Ti = rand(.7, 1.25);
    items.push({ type, v: pickVariant(type), mode: 'fly', hit: true, keep: true, d: rand(0, .15), t: 0, Z0, z: Z0, zHit, Ti, C, s0, rot: rand(0, TAU), vr: rand(-2.5, 2.5), alpha: 1,
      ohx: (Tx - C.x) * zHit / Z0, ohy: (Ty - C.y) * zHit / Z0, slotX: slot0 + slot * (i + .5) });
  });
  P.liftTarget = H * 1.3;
}
function updateItems(dt) {
  items.forEach(it => {
    if (it.mode === 'fly') {
      if (it.d > 0) { it.d -= dt; return; }
      it.t += dt; it.rot += it.vr * dt;
      if (it.hit) {
        const u = Math.min(1, it.t / it.Ti);
        it.z = it.Z0 + (it.zHit - it.Z0) * u;
        const k = it.Z0 / it.z;
        it.x = it.C.x + it.ohx * u * k; it.y = it.C.y + it.ohy * u * k; it.size = it.s0 * k * HSCALE[it.type];
        if (u >= 1) {
          it.mode = 'stick'; it.st = .1; SFX.thunk(); vibrate(15);
          flashes.push({ x: it.x, y: it.y, t: 0, ring: true });
          it.vx = 0; it.vy = -S * rand(.15, .4); it.bounces = 0; it.ft = 0; it.fx0 = it.x;
        }
      } else {
        it.z -= it.vz * dt;
        const k = it.Z0 / Math.max(.3, it.z);
        it.x = it.C.x + (it.ox + it.dx * it.t) * k; it.y = it.C.y + (it.oy + it.dy * it.t + .5 * it.gy * it.t * it.t) * k;
        it.size = it.s0 * k * TSCALE[it.type];
        if (it.z < .7 || it.x < -it.size || it.x > W + it.size || it.y < -it.size || it.y > H + it.size) it.dead = true;
      }
    } else if (it.mode === 'stick') {
      it.st -= dt; if (it.st <= 0) it.mode = 'fall';
    } else if (it.mode === 'collect') {
      it.ct += dt;
      if (it.ct > COLLECT_T) { it.dead = true; flashes.push({ x: it.x, y: it.y - S * .14, t: 0, puff: it.size * .5 }); }
    } else if (it.mode === 'rest') {
      it.bob += dt;
    } else {
      it.ft += dt;
      const r = it.size * .42;
      it.vy += H * 2.3 * dt; it.y += it.vy * dt;
      if (it.keep) {
        // avanza hacia su lugar en la fila mientras rebota
        const u = Math.min(1, it.ft / 1.5), nx = it.fx0 + (it.slotX - it.fx0) * (1 - (1 - u) ** 3);
        it.rot += (nx - it.x) / r; it.x = nx;
      } else { it.x += it.vx * dt; it.rot += it.vr * dt; }
      const fy = H - r - floorGap(it);
      if (it.y > fy) {
        it.y = fy;
        if (it.vy > H * .12) {
          if (it.vy > H * .28) { SFX.pop(it.vy / (H * 1.6)); it.bounces++; vibrate(8); }
          it.vy = -it.vy * .62;
          if (!it.keep) it.vx = (it.vx < 0 ? -1 : 1) * Math.max(Math.abs(it.vx), S * 1.4);   // sale disparada rodando
        } else { it.vy = 0; it.rolling = true; }
        if (!it.keep) it.vr = it.vx / r;
      }
      const onFloor = it.rolling && it.y >= fy;
      if (onFloor && !it.keep) { it.vx = (it.vx < 0 ? -1 : 1) * Math.max(Math.abs(it.vx), S * 1.6); it.vr = it.vx / r; }
      if (!it.keep && (it.x < -it.size || it.x > W + it.size)) it.dead = true;
      if (it.mode === 'fall') {
        if (!it.keep) { if (it.ft > 8) it.mode = 'fade'; }
        else if (onFloor && it.vy === 0 && it.ft >= 1.5) { it.mode = 'rest'; it.bob = rand(0, TAU); it.x = it.slotX; }
      }
      if (it.mode === 'fade') { it.alpha -= dt * 1.3; if (it.alpha <= 0) it.dead = true; }
    }
  });
  items = items.filter(i => !i.dead);
  items.forEach(it => { if (it.mode === 'rest') it.y = H - it.size * .42 - floorGap(it); });
}
// distancia al borde inferior: las frutas a recolectar quedan más arriba
const floorGap = it => it.keep ? H * .075 : H * .015;
// Frutas que salen en el golpe 6 (no se recolectan)
function dropFruits(f, n) {
  const types = [...HITTERS].sort(() => Math.random() - .5).slice(0, n);
  types.forEach(type => items.push({
    type, v: pickVariant(type), mode: 'fall', x: f.cx + rand(-1, 1) * model.R * .3, y: f.cy + model.R * .2,
    size: S * .17 * TSCALE[type], vx: rand(-1, 1) * S * .9, vy: -S * rand(.5, 1), rot: rand(0, TAU), vr: rand(-4, 4), alpha: 1, bounces: 0, ft: 0
  }));
}
function tryCollect(x, y) {
  const it = items.filter(i => i.keep && (i.mode === 'fall' || i.mode === 'rest'))
    .find(i => Math.hypot(x - i.x, y - i.y) < Math.max(34, i.size * .62));
  if (!it) return;
  it.mode = 'collect'; it.ct = 0;
  words.push({ type: it.type, x: it.x, y: it.y - S * .14 - it.size * .9, t: -.12 });
  SFX.boing(); vibrate(20);
  setTimeout(() => SFX.collect(), 300);
  if (++collected >= HITTERS.length) finalTimer = WORD_FLY_END + .3;
}
// El deseo aparece sobre la fruta, se queda un momento y vuela a su lugar en el letrero final
const WORD_POP = .15, WORD_HOLD = .12, WORD_FLY_END = .8, COLLECT_T = .5;
function drawWords(dt) {
  words.forEach(w => {
    w.t += dt;
    if (w.t < 0) return;
    const sp = A.words[w.type], big = 1;
    const sx = clamp(w.x, sp.w * big / 2 + 10, W - sp.w * big / 2 - 10), sy = Math.max(sp.h * big, w.y - sp.h * big * .6);
    const tx = sp.x + sp.w / 2, ty = sp.y + sp.h / 2;
    let x = sx, y = sy, sc = big;
    if (w.t < WORD_POP) { const u = w.t / WORD_POP; sc = 1 + 2.4 * (u - 1) ** 3 + 1.4 * (u - 1) ** 2; }
    else if (w.t > WORD_HOLD) {
      const u = Math.min(1, (w.t - WORD_HOLD) / (WORD_FLY_END - WORD_HOLD)), e = u < .5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
      x = sx + (tx - sx) * e; y = sy + (ty - sy) * e - Math.sin(Math.PI * e) * S * .08;
    }
    ctx.drawImage(sp.img, x - sp.w * sc / 2, y - sp.h * sc / 2, sp.w * sc, sp.h * sc);
  });
}
// Recolectar: se aplasta, salta estirándose, rebota en el aire y desaparece encogiéndose
function squash(it) {
  const t = it.ct, h = it.size, k = (a, b, u) => a + (b - a) * u;
  const ease = u => 1 - (1 - u) ** 2;
  if (t < .1) { const u = ease(t / .1); return { sx: k(1, 1.3, u), sy: k(1, .7, u), oy: h * .15 * u, rot: it.rot }; }
  if (t < .24) { const u = ease((t - .1) / .14); return { sx: k(1.3, .78, u), sy: k(.7, 1.32, u), oy: k(h * .15, -S * .14, u), rot: it.rot * (1 - u) }; }
  if (t < .34) { const u = ease((t - .24) / .1); return { sx: k(.78, 1.15, u), sy: k(1.32, .88, u), oy: -S * .14, rot: 0 }; }
  const u = (t - .34) / (COLLECT_T - .34), s = Math.max(0, 1 - u * u) * 1.15;
  return { sx: s, sy: s * (.88 + .12 * u), oy: -S * .14, rot: Math.sin(u * 9) * .25 };
}
function drawItems(t) {
  const zOf = i => i.mode === 'fly' ? i.z : 0;
  // brillo que invita a recolectar
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  items.forEach(it => {
    if (it.mode !== 'rest') return;
    const r = it.size * (.85 + .12 * Math.sin(t * 3 + it.bob));
    ctx.globalAlpha = .35 + .2 * Math.sin(t * 3 + it.bob);
    ctx.drawImage(glow('#fff3b0'), it.x - r, it.y - r, r * 2, r * 2);
  });
  ctx.restore();
  items.filter(i => i.x !== undefined && !(i.mode === 'fly' && i.d > 0)).sort((a, b) => zOf(b) - zOf(a)).forEach(it => {
    const s = it.size * 1.12, a = it.v.aspect, w = a >= 1 ? s : s * a, h = a >= 1 ? s / a : s;
    ctx.save(); ctx.globalAlpha = clamp(it.alpha, 0, 1) * (it.mode === 'fly' ? clamp(it.t * 6, 0, 1) : 1);
    let sc = 1, oy = 0;
    if (it.mode === 'rest') oy = -Math.abs(Math.sin(t * 2.2 + it.bob)) * it.size * .06;
    let sx = 1, sy = 1, rot = it.rot;
    if (it.mode === 'collect') ({ sx, sy, oy, rot } = squash(it));
    ctx.translate(it.x, it.y + oy); ctx.rotate(rot); ctx.scale(sc * sx, sc * sy);
    if (it.mode === 'stick') ctx.scale(1.1, .9);
    ctx.drawImage(it.v.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  });
}
function drawFlashes(dt) {
  flashes.forEach(fl => {
    fl.t += dt;
    if (fl.puff) {
      // nubecitas suaves al desaparecer
      const u = fl.t / .45; if (u >= 1) return;
      ctx.save(); ctx.globalAlpha = (1 - u) * .85; ctx.fillStyle = '#fff6e0';
      for (let i = 0; i < 6; i++) {
        const an = i / 6 * TAU + .5, d = fl.puff * (.35 + u * .9);
        ctx.beginPath(); ctx.arc(fl.x + Math.cos(an) * d, fl.y + Math.sin(an) * d, fl.puff * .28 * (1 - u * .7), 0, TAU); ctx.fill();
      }
      ctx.restore()    } else if (fl.big) {
      const a = 1 - fl.t / .35; if (a > 0) { ctx.fillStyle = `rgba(255,250,220,${a * .55})`; ctx.fillRect(0, 0, W, H); }
      const ra = 1 - fl.t / .5;
      if (ra > 0) { ctx.strokeStyle = `rgba(255,230,120,${ra})`; ctx.lineWidth = S * .03 * ra; ctx.beginPath(); ctx.arc(fl.x, fl.y, S * (.2 + fl.t * 2.2), 0, TAU); ctx.stroke(); }
    } else {
      const a = 1 - fl.t / (fl.ring ? .45 : .3); if (a <= 0) return;
      const r = (fl.ring ? S * .12 : S * .07) * (.4 + fl.t * 3);
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, S * .012);
      for (let i = 0; i < 8; i++) {
        const an = i / 8 * TAU + .3; ctx.beginPath();
        ctx.moveTo(fl.x + Math.cos(an) * r * .55, fl.y + Math.sin(an) * r * .55); ctx.lineTo(fl.x + Math.cos(an) * r, fl.y + Math.sin(an) * r); ctx.stroke();
      }
      if (fl.ring) { ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(fl.x, fl.y, r * .8, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
  });
  flashes = flashes.filter(f => f.t < .6);
}
function drawRays(dt) {
  if (!rays) return; rays.t += dt; const a = 1 - rays.t / .9; if (a <= 0) { rays = null; return; }
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .8;
  for (let i = 0; i < 18; i++) {
    const an = i / 18 * TAU + .1, l0 = S * (.1 + rays.t * 1.2), l1 = l0 + S * (.35 + (i % 3) * .12);
    ctx.strokeStyle = i % 2 ? '#bfe6ff' : '#fff2b0'; ctx.lineWidth = S * (.012 + (i % 2) * .008);
    ctx.beginPath(); ctx.moveTo(rays.x + Math.cos(an) * l0, rays.y + Math.sin(an) * l0); ctx.lineTo(rays.x + Math.cos(an) * l1, rays.y + Math.sin(an) * l1); ctx.stroke();
  }
  ctx.restore();
}

/* ---------- indicación ---------- */
let hintAlive = false;
function showHint() { const h = $('hint'); h.classList.remove('hide'); h.classList.add('show'); hintShown = true; hintAlive = true; }
function placeHint(f) { $('hint').style.transform = `translate(${f.cx - 17.5}px,${f.cy + model.R * .1}px)`; }
function hideHint() {
  const h = $('hint');
  if (h.classList.contains('show')) { h.classList.remove('show'); h.classList.add('hide'); setTimeout(() => { hintAlive = false; }, 600); }
}

/* ============================================================
   Bucle principal
   ============================================================ */
let last = performance.now(), clock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const cur = FINE && (state === 'intro' || state === 'play') ? 'none' : 'pointer';
  if (cv.style.cursor !== cur) cv.style.cursor = cur;
  const dt = Math.min(1 / 30, (now - last) / 1000); last = now; clock += dt;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawScene(clock);
  wshake *= Math.exp(-dt * 6);
  ctx.save();
  if (wshake > .01) ctx.translate(Math.sin(now * .09) * S * .02 * wshake, Math.cos(now * .11) * S * .02 * wshake);
  drawLights(clock);

  if (state === 'intro') {
    hintTimer += dt;
    if (hintTimer > .9 && !hintShown) showHint();
    if (hintTimer > 3.5) { hideHint(); state = 'play'; }
  }
  if (riseTimer > 0) { riseTimer -= dt; if (riseTimer <= 0) { P.liftTarget = Math.max(0, cy0 - model.R * .15); SFX.rise(); holdTimer = .75; } }
  if (holdTimer > 0) { holdTimer -= dt; if (holdTimer <= 0) P.liftTarget = 0; }

  updatePendulum(dt);
  const f = pinFrame();
  if (state === 'intro' || state === 'play') {
    updateTassels(f, dt);
    drawRope(f);
    drawPinata(f);
    if (hintAlive) placeHint(f);
    drawCracks(f);
    drawWraps(f);
    drawTassels(f, clock);
  } else {
    drawRope(f);
    drawRays(dt);
  }
  updateItems(dt); drawItems(clock);
  updateConfetti(dt); drawConfetti();
  if (state !== 'final') drawWords(dt);
  if (finalTimer > 0) { finalTimer -= dt; if (finalTimer <= 0) { state = 'final'; $('final').classList.add('show'); playJingle(); } }
  drawFlashes(dt);
  ctx.restore();

  if (stick) {
    stick.t += dt; const t = stick.t, base = stickBaseAngle(stick.x, stick.y);
    let off, al = 1;
    if (t < .08) off = -1 + t / .08;
    else if (t < .14) off = 0;
    else { off = -(t - .14) * 2.5; al = 1 - (t - .14) / .25; }
    const side = stick.x < W / 2 ? -1 : 1;
    if (al > 0) drawStick(stick.x, stick.y, base + side * off * .6, FINE ? 1 : al);
    if (t > .4) stick = null;
  } else if (FINE && mouse.in && (state === 'intro' || state === 'play')) {
    const side = mouse.x < W / 2 ? -1 : 1;
    drawStick(mouse.x, mouse.y, stickBaseAngle(mouse.x, mouse.y) - side * .35, 1);
  }
}

/* ============================================================
   Eventos
   ============================================================ */
cv.addEventListener('pointerdown', onDown, { passive: false });
cv.addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true; });
cv.addEventListener('pointerleave', () => { mouse.in = false; });
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
$('mute').addEventListener('pointerdown', e => e.stopPropagation());
$('mute').addEventListener('click', e => {
  e.stopPropagation(); initAudio();
  muted = !muted;
  $('mute').classList.toggle('muted', muted);
  $('mute').setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar sonido');
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, AC.currentTime, .02);
  if (!muted) SFX.test();
});
$('again').addEventListener('click', e => { e.stopPropagation(); initAudio(); SFX.pop(.8); stopJingle(); reset(); startSong(); });
let rT;
window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(rebuild, 150); });

prepLuces();
(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(rebuild);
}
