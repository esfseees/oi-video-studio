// ===== OI Video Studio player: every frame is a pure function of time t (seconds) =====
const W = 1920, H = 1080;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let TL = null, SB = null, CODE = [], CHAR = null, t = 0;
const TITLE = '"FZLanTingYuanS-H-GB","Yuanti SC","PingFang SC","Microsoft YaHei",sans-serif';
const BODY = '"Yuanti SC","PingFang SC","Microsoft YaHei",sans-serif';
const PLAIN = '"PingFang SC","Microsoft YaHei",sans-serif';
const MONO = 'Menlo,Consolas,"PingFang SC",monospace';
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const INK = '#243B6B';
const PAL = {                                   // highlight colours: fill, border, text
  yellow: ['#FFE27A', '#F2A900', '#6B4A00'], green: ['#B9F0B0', '#3DB54A', '#165C20'],
  red: ['#FFC2BD', '#F0564A', '#7A1810'], blue: ['#BDE6FF', '#2D9CF0', '#0B4A80'],
  purple: ['#DCCBFF', '#8B62F0', '#3D2190'], orange: ['#FFD3A6', '#F58A1F', '#7A3D00'],
  gray: ['#D9DEE8', '#9AA5B8', '#4A5568'], none: ['#EEF3FF', '#B7C6E6', '#243B6B'],
};
const pal = c => PAL[c] || PAL.yellow;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;
const eio = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const eo = u => 1 - Math.pow(1 - u, 3);
const back = u => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const pr = (t0, d) => clamp((t - t0) / d);
const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const stepAt = () => { let k = 0; for (let i = 0; i < TL.steps.length; i++) if (t >= TL.steps[i].s) k = i; return k; };
function mixHex(a, b, u) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), x = p(a), y = p(b);
  return 'rgb(' + x.map((v, i) => Math.round(lerp(v, y[i], clamp(u)))).join(',') + ')';
}

function rr(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function box(x, y, w, h, r, fill, stroke, lw) {
  rr(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw || 4; ctx.strokeStyle = stroke; ctx.stroke(); }
}
const isEmoji = s => /\p{Extended_Pictographic}/u.test(String(s));
function setFont(o) { ctx.font = `${o.w || 'bold'} ${o.size || 36}px ${o.font || BODY}`; }
function txt(s, x, y, o = {}) {
  s = String(s); setFont(o);
  ctx.textAlign = o.align || 'center'; ctx.textBaseline = o.base || 'middle';
  if (o.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = o.sw || 8; ctx.strokeStyle = o.stroke; ctx.strokeText(s, x, y); }
  ctx.fillStyle = o.color || '#1F2D3D'; ctx.fillText(s, x, y);
}
function tw(s, o = {}) { setFont(o); return ctx.measureText(String(s)).width; }
function fitTxt(s, x, y, maxW, o = {}) {                   // shrink font until the text fits maxW
  let size = o.size || 36; while (size > 12 && tw(s, { ...o, size }) > maxW) size -= 1;
  txt(s, x, y, { ...o, size });
}
function emoji(s, x, y, size) { txt(s, x, y, { size, font: EMOJI, w: 'normal' }); }
function pill(x, y, s, o = {}) {
  const size = o.size || 36, h = o.h || size * 1.75, w = (o.width || tw(s, { size, font: o.font, w: o.w }) + (o.pad || size * 1.1));
  if (o.shadow !== false) { ctx.save(); ctx.globalAlpha *= .16; box(x - w / 2, y - h / 2 + 7, w, h, h / 2, '#0B2A5B'); ctx.restore(); }
  box(x - w / 2, y - h / 2, w, h, o.r || h / 2, o.bg || '#fff', o.border || INK, o.lw || 4);
  txt(s, x, y + 1, { size, color: o.color || INK, font: o.font, w: o.w });
  return w;
}
function pop(x, y, u, fn) {
  if (u <= 0) return;
  ctx.save(); ctx.translate(x, y); const sc = back(clamp(u)); ctx.scale(sc, sc); ctx.globalAlpha *= clamp(u * 3); fn(); ctx.restore();
}
function fade(a, fn) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= clamp(a); fn(); ctx.restore(); }
function arrow(x1, y1, x2, y2, col, lw) {
  const a = Math.atan2(y2 - y1, x2 - x1), hd = lw * 3.2;
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(a) * hd * .8, y2 - Math.sin(a) * hd * .8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(a - .45) * hd, y2 - Math.sin(a - .45) * hd);
  ctx.lineTo(x2 - Math.cos(a + .45) * hd, y2 - Math.sin(a + .45) * hd); ctx.closePath(); ctx.fill();
}

// ---------- backgrounds ----------
function cloud(x, y, s, a) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha *= a; ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(0, 0, 46, 0, 7); ctx.arc(52, -18, 58, 0, 7); ctx.arc(116, 0, 44, 0, 7); ctx.arc(58, 16, 50, 0, 7); ctx.fill();
  ctx.restore();
}
const THEMES = {
  night() {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0B1640'); g.addColorStop(1, '#27408F');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const a = .35 + .5 * Math.abs(Math.sin(t * (.6 + rnd(i) * 1.4) + i));
      ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.arc(rnd(i + 5) * W, rnd(i + 99) * H * .9, 1.2 + rnd(i + 7) * 2.2, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#FFE9A8'; ctx.beginPath(); ctx.arc(1790, 96, 44, 0, 7); ctx.fill();
    ctx.fillStyle = '#101D52'; ctx.beginPath(); ctx.arc(1770, 84, 40, 0, 7); ctx.fill();
  },
  day() {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#6EC3FF'); g.addColorStop(.75, '#DDF4FF'); g.addColorStop(1, '#BFEBC6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#FFD84D'; ctx.beginPath(); ctx.arc(1780, 110, 62, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,216,77,.55)'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6 + t * .25; ctx.beginPath(); ctx.moveTo(1780 + Math.cos(a) * 80, 110 + Math.sin(a) * 80); ctx.lineTo(1780 + Math.cos(a) * 104, 110 + Math.sin(a) * 104); ctx.stroke(); }
    for (let i = 0; i < 5; i++) cloud(((rnd(i) * 2400 + t * (8 + i * 3)) % 2400) - 240, 70 + rnd(i + 3) * 190, .7 + rnd(i + 9) * .7, .8);
    ctx.fillStyle = '#8FD98B'; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, 1010);
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, 1006 + Math.sin(x / 190) * 16); ctx.lineTo(W, H); ctx.fill();
  },
  ocean() {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0E5FA8'); g.addColorStop(1, '#0A2B5C');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(255,255,255,${.035 + i * .008})`; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 30) ctx.lineTo(x, 180 + i * 190 + Math.sin(x / (150 + i * 30) + t * (.5 + i * .12) + i) * 22); ctx.lineTo(W, H); ctx.fill();
    }
    for (let i = 0; i < 26; i++) {
      const y = H - ((rnd(i) * H + t * (30 + rnd(i + 2) * 40)) % (H + 60)), x = rnd(i + 40) * W + Math.sin(t + i) * 14;
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 6 + rnd(i + 8) * 12, 0, 7); ctx.stroke();
    }
  },
};
function drawBg() { (THEMES[SB.theme] || THEMES.night)(); }

// ---------- narrator character (any uploaded picture) ----------
let CHAR_IMG = null;
function mouthLevel() {                                     // 0..1, smoothed over neighbouring frames
  const f = Math.min(TL.mouth.length - 1, Math.floor(t * TL.fps + 1e-6));
  let a = 0; for (let i = -1; i <= 1; i++) a += TL.mouth[clamp(f + i, 0, TL.mouth.length - 1)] || 0;
  return a / 3;
}
function drawChar(x, y, s, o = {}) {                        // (x,y): centre, picture fits a 220px box at s=1
  if (!CHAR_IMG) return;
  const iw = CHAR_IMG.naturalWidth, ih = CHAR_IMG.naturalHeight, k = 220 / Math.max(iw, ih), m = mouthLevel();
  const f = Math.min(TL.mouth.length - 1, Math.floor(t * TL.fps + 1e-6)), open = TL.mouth[f];
  ctx.save(); ctx.translate(x, y + Math.sin(t * 2.3) * 7 * s);
  ctx.rotate(Math.sin(t * 1.4) * .035 + (o.wave ? Math.sin(t * 6.5) * .085 : 0));
  const mm = CHAR.mouth;
  if (!mm) {                                                // no mouth info: gentle squash while talking + sound waves
    ctx.translate(0, ih * k * s / 2); ctx.scale(1 - .018 * m, 1 + .04 * m); ctx.translate(0, -ih * k * s / 2);
    if (m > 0) {
      ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${.85 * m})`; ctx.lineWidth = 5 * s; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(iw * k * s * .42, -ih * k * s * .34, (16 + i * 13) * s, -1.15, -.25); ctx.stroke(); }
      ctx.restore();
    }
  }
  ctx.scale(s * k, s * k); ctx.translate(-iw / 2, -ih / 2);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(CHAR_IMG, 0, 0);
  if (mm && open) {                                         // known mouth position: swap in an open mouth
    ctx.fillStyle = mm.bg; ctx.beginPath(); ctx.arc(mm.x, mm.y, mm.r * 1.45, 0, 7); ctx.fill();
    ctx.fillStyle = mm.color; ctx.beginPath(); ctx.ellipse(mm.x, mm.y + 1, mm.r, mm.r * 1.15, -.12, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// ---------- subtitle ----------
function subtitle() {
  const k = stepAt(), st = TL.steps[k];
  if (t < st.s - .05 || t > st.n - .12) return;
  const a = Math.min(pr(st.s - .05, .2), 1 - pr(st.n - .32, .2));
  let size = 40, lines = [st.text]; const maxw = 1540;
  if (tw(st.text, { size }) > maxw) {
    size = 37; const mid = st.text.length / 2; let best = -1;
    for (let i = 0; i < st.text.length - 1; i++) if ('，。；！？：、,;!? '.includes(st.text[i]) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    if (best < 0) best = Math.floor(mid);
    lines = [st.text.slice(0, best + 1), st.text.slice(best + 1)];
    while (size > 22 && Math.max(tw(lines[0], { size }), tw(lines[1], { size })) > maxw) size -= 1;
  }
  fade(a, () => {
    box(232, 944, 1654, 112, 36, 'rgba(18,48,92,.88)', '#fff', 4);
    lines.forEach((l, i) => txt(l.trim(), 232 + 827, 1000 + (i - (lines.length - 1) / 2) * 50, { size, color: '#fff' }));
  });
}
