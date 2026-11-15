// ===== main: build scenes from the storyboard, lay out widgets, draw frame at time t =====
let SCENES = [], ERR = [];
const S = k => TL.steps[k].s, E = k => TL.steps[k].e, N = k => TL.steps[k].n;
const DUR = { hl: .45, clear: .4, swap: .8, reorder: 1.1, set: .5, push: .5, pop: .55, ptr: .5, setAll: .5, mark: .5, num: .5, actor: .5, line: .6, text: .5, hlin: .3, focus: .35, reveal: .01, show: .4, hide: .4 };

function build() {
  SCENES = []; CODE_ACTS = []; let k = 0; const total = TL.steps.length;
  for (const sc0 of SB.scenes) {
    const steps = sc0.steps || [], n = steps.length; if (!n || k >= total) continue;
    const sc = { ...sc0, k0: k, k1: Math.min(total, k + n) - 1, widgets: [] };
    const map = {};
    for (const d of (sc0.widgets || [])) { if (!d || !WG[d.type] || map[d.id]) continue; const w = { ...d, acts: [] }; map[d.id] = w; sc.widgets.push(w); }
    steps.forEach((st, j) => {
      const kk = k + j; if (kk >= total) return;
      const acts = (st.do || []).filter(a => a && map[a.w]);
      acts.forEach((a, i) => {
        const f = typeof a.at === 'number' ? clamp(a.at) : (acts.length === 1 ? .12 : .06 + .82 * i / acts.length);
        const t0 = S(kk) + (E(kk) - S(kk)) * f, w = map[a.w]; let dur = DUR[a.op] || .5;
        if (a.op === 'move') dur = clamp(.34 * Math.max(1, (a.path || []).length), .4, Math.max(.4, N(kk) - t0 - .1));
        if (a.op === 'out') dur = clamp(String(a.text || '').length * .06, .3, 1.6);
        if (a.op === 'type') {
          const [lo, hi] = lineRange(a); let ch = 0; for (let i2 = lo; i2 <= hi; i2++) ch += CODE[i2 - 1].length + 1;
          dur = clamp(ch / 42, .5, Math.max(.5, N(kk) - t0 - .25));
        }
        w.acts.push({ ...a, t0, dur });
      });
    });
    for (const w of sc.widgets) {
      w.acts.sort((a, b) => a.t0 - b.t0);
      if (w.type === 'code') CODE_ACTS.push(...w.acts.filter(a => a.op === 'type' || a.op === 'reveal'));
      try { WG[w.type].init(w); } catch (e) { ERR.push('init ' + w.id + ': ' + e.message); w.bad = true; }
    }
    sc.widgets = sc.widgets.filter(w => !w.bad);
    sc.first = SCENES.length === 0;
    sc.tin = sc.first ? -1 : S(sc.k0) - .1; sc.tout = N(sc.k1) - .5;
    k += n; SCENES.push(sc);
  }
  if (SCENES.length) SCENES[SCENES.length - 1].last = true;
  CODE_ACTS.sort((a, b) => a.t0 - b.t0); CODE_ALL = CODE_ACTS.length === 0;
  for (const sc of SCENES) if ((sc.kind || 'stage') === 'stage') layout(sc);
}

function layout(sc) {
  const top = sc.title ? 112 : 64, bot = 920, PAD = 26, GAP = 26;
  const code = sc.widgets.find(w => w.type === 'code'), rest = sc.widgets.filter(w => w !== code);
  let ax = 50, aw = 1820;
  if (code) { const s = Math.min(1, (bot - top) / 800); code._b = { x: 1890 - 960 * s, y: top + (bot - top - 800 * s) / 2, s, w: 960, h: 800 }; ax = 30; aw = code._b.x - 30 - 24; }
  for (const w of rest) {
    let sz; try { sz = WG[w.type].size(w); } catch (e) { ERR.push('size ' + w.id + ': ' + e.message); sz = [300, 100]; }
    w._nw = sz[0]; w._nh = sz[1]; w._pad = WG[w.type].nocard ? 0 : PAD; w._bw = sz[0] + 2 * w._pad; w._bh = sz[1] + 2 * w._pad;
  }
  if (!rest.length) return;
  // pack widgets into rows: try every way to split the ordered list into consecutive rows, keep the largest scale
  const n = rest.length, ah = bot - top, full = (1 << (n - 1)) - 1;
  const masks = sc.layout === 'row' ? [0] : (sc.layout === 'column' || n > 6) ? [full] : Array.from({ length: full + 1 }, (_, i) => full - i);
  let best = null;
  for (const m of masks) {
    const rows = [[]]; rest.forEach((w, i) => { rows[rows.length - 1].push(w); if (i < n - 1 && (m >> i) & 1) rows.push([]); });
    const rw = rows.map(r => r.reduce((x, w) => x + w._bw, 0) + GAP * (r.length - 1)), rh = rows.map(r => Math.max(...r.map(w => w._bh)));
    const th = rh.reduce((x, y) => x + y, 0) + GAP * (rows.length - 1), sc1 = Math.min(aw / Math.max(...rw), ah / th, 1.8);
    if (!best || sc1 > best.s + 1e-6) best = { s: sc1, rows, rw, rh, th };
  }
  let y = top + (ah - best.th * best.s) / 2;
  best.rows.forEach((r, i) => {
    let x = ax + (aw - best.rw[i] * best.s) / 2;
    for (const w of r) { w._b = { x, y: y + (best.rh[i] - w._bh) * best.s / 2, s: best.s }; x += (w._bw + GAP) * best.s; }
    y += (best.rh[i] + GAP) * best.s;
  });
}

function drawStage(sc, alpha) {
  if (sc.title) fade(alpha, () => pill(960, 58, sc.title, { size: 38, bg: '#FFE27A', border: '#F2A900', color: '#5A3D00' }));
  sc.widgets.forEach((w, i) => {
    const b = w._b; if (!b) return;
    let a = w.hidden ? 0 : clamp((t - S(sc.k0) + .1 - i * .12) / .45); if (sc.first) a = w.hidden ? 0 : 1;
    for (const x of w.acts) { if (t < x.t0) break; if (x.op === 'show') a = Math.max(a, ap(x)); else if (x.op === 'hide') a = Math.min(a, 1 - ap(x)); }
    if (a <= 0) return;
    const bw = (w._bw || b.w) * b.s, bh = (w._bh || b.h) * b.s;
    ctx.save(); ctx.globalAlpha = alpha * clamp(a * 1.6);
    ctx.translate(b.x + bw / 2, b.y + bh / 2); const e = .9 + .1 * back(clamp(a)); ctx.scale(e, e); ctx.translate(-bw / 2, -bh / 2); ctx.scale(b.s, b.s);
    try {
      if (w.type === 'code') WG.code.draw(w);
      else {
        if (w._pad) { ctx.save(); ctx.globalAlpha *= .18; box(0, 10, w._bw, w._bh, 32, '#061A45'); ctx.restore(); box(0, 0, w._bw, w._bh, 32, 'rgba(255,255,255,.96)', '#DCE6FF', 4); ctx.translate(w._pad, w._pad); }
        WG[w.type].draw(w, w._nw, w._nh);
      }
    } catch (err) { if (ERR.length < 20) ERR.push('draw ' + w.id + ': ' + err.message); }
    ctx.restore();
  });
}

function introTimes(sc) { const m = sc.k1 > sc.k0 ? S(sc.k0 + 1) + .15 : lerp(S(sc.k0), E(sc.k0), .55); return { m, out: N(sc.k1) - .75 }; }
function drawIntro(sc, alpha) {
  const { m } = introTimes(sc);
  if (CHAR.name) { const u = Math.min(pr(1.0, .4), 1 - pr(m - .25, .25)); pop(960, 190, u, () => pill(0, 0, '嗨！我是' + CHAR.name, { size: 46 })); }
  fade(alpha, () => {
    if (SB.algorithm) pop(1180, 318, pr(m + .25, .45), () => pill(0, 0, SB.algorithm, { size: 44, bg: '#FF6B5E', border: '#fff', color: '#fff' }));
    pop(1180, 470, pr(m + .45, .5), () => fitTxt(SB.title || '', 0, 0, 1150, { size: 128, font: TITLE, color: '#fff', stroke: '#1D4FA8', sw: 20 }));
    pop(1180, 622, pr(m + .8, .45), () => pill(0, 0, (SB.lang === 'python' ? 'Python' : 'C++') + ' 动画讲解', { size: 40, bg: '#FFE27A', border: '#F2A900', color: '#5A3D00' }));
  });
}
function drawOutro(sc, alpha) {
  const pts = arr(sc.points).slice(0, 4).map(String), n = pts.length, ns = sc.k1 - sc.k0 + 1;
  fade(alpha, () => {
    pill(690, 150, sc.title || '总结', { size: 50, bg: '#FFE27A', border: '#F2A900', color: '#5A3D00' });
    const ch = 118, gap = 26, y0 = 500 - (n * ch + (n - 1) * gap) / 2 + 40;
    pts.forEach((p, i) => {
      const ts = n <= ns ? S(sc.k0 + i) + .2 : lerp(S(sc.k0), E(sc.k1), i / n) + .2;
      pop(690, y0 + i * (ch + gap) + ch / 2, pr(ts, .5), () => {
        ctx.save(); ctx.globalAlpha *= .18; box(-590, -ch / 2 + 9, 1180, ch, 30, '#061A45'); ctx.restore();
        box(-590, -ch / 2, 1180, ch, 30, 'rgba(255,255,255,.97)', '#DCE6FF', 4);
        ctx.beginPath(); ctx.arc(-520, 0, 34, 0, 7); ctx.fillStyle = '#2D9CF0'; ctx.fill(); txt(i + 1, -520, 2, { size: 38, color: '#fff', font: PLAIN });
        fitTxt(p, -460, 3, 1020, { size: 42, align: 'left', color: INK });
      });
    });
  });
  const c0 = S(sc.k1);
  if (t > c0) for (let i = 0; i < 90; i++) {
    const d = t - c0 - rnd(i) * 1.2; if (d < 0) continue;
    const x = rnd(i + 20) * W + Math.sin(d * 2 + i) * 30, y = -40 + d * (210 + rnd(i + 3) * 220); if (y > H) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(d * (2 + rnd(i + 9) * 4)); ctx.fillStyle = Object.values(PAL)[i % 6][1]; ctx.fillRect(-9, -5, 18, 10); ctx.restore();
  }
}

function charPose() {
  const corner = { x: 125, y: 985, s: .8 }, keys = [];
  const add = (tt, p, wave) => keys.push({ t: tt, ...p, wave });
  const intro = SCENES.find(s => s.kind === 'intro'), outro = SCENES.find(s => s.kind === 'outro');
  if (intro && intro.first) {
    const { m, out } = introTimes(intro), big = { x: 960, y: 500, s: 2.2 }, side = { x: 330, y: 500, s: 1.8 };
    add(0, { x: -300, y: 500, s: 2.2 }, true); add(.9, big, true); add(m, big, true); add(m + .7, side, false); add(out, side, false); add(out + .75, corner, false);
  } else add(0, corner, false);
  if (outro) { const o = S(outro.k0) - .1, big = { x: 1570, y: 520, s: 1.75 }; add(o, corner, false); add(o + .8, big, true); add(1e9, big, true); }
  let a = keys[0], b = keys[0];
  for (let i = 0; i < keys.length; i++) { if (keys[i].t <= t) { a = keys[i]; b = keys[Math.min(i + 1, keys.length - 1)]; } }
  const u = b.t > a.t ? eio(clamp((t - a.t) / (b.t - a.t))) : 0;
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), s: lerp(a.s, b.s, u), wave: a.wave && (b.wave || u < .5) };
}

function draw(tt) {
  t = tt;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
  drawBg();
  for (const sc of SCENES) {
    const alpha = Math.min(sc.first ? 1 : pr(sc.tin, .4), sc.last ? 1 : 1 - pr(sc.tout, .4));
    if (alpha <= 0) continue;
    ctx.save();
    if (sc.kind === 'intro') drawIntro(sc, alpha); else if (sc.kind === 'outro') drawOutro(sc, alpha); else drawStage(sc, alpha);
    ctx.restore();
  }
  subtitle();
  const p = charPose(); drawChar(p.x, p.y, p.s, { wave: p.wave });
}

window.init = async function (data) {
  SB = data.storyboard; TL = data.timeline; CHAR = data.character || {};
  CODE = String(data.code || '').replace(/\t/g, '    ').replace(/\s+$/, '').split('\n');
  await document.fonts.ready;
  if (CHAR.src) { CHAR_IMG = new Image(); CHAR_IMG.src = CHAR.src; try { await CHAR_IMG.decode(); } catch (e) { CHAR_IMG = null; ERR.push('character image failed to load'); } }
  build();
  return { scenes: SCENES.length, errors: ERR };
};
window.renderAt = function (tt) { draw(tt); };
window.playerErrors = () => ERR;
