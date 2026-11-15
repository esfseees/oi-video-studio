// ===== widgets (part A): array / queue / stack, vars, note, io =====
// Each widget draws in local coordinates (0,0)-(w,h) of its natural size; layout scales and places it.
// State is rebuilt every frame by replaying the widget's actions up to time t.
const WG = {};
const ap = a => clamp((t - a.t0) / a.dur);
const arr = v => Array.isArray(v) ? v : (v == null ? [] : [v]);

WG.array = {
  init(w) {
    w.values = arr(w.values); w.base = w.base === 1 ? 1 : 0; w.kind = w.kind || 'array';
    w._icons = Array.isArray(w.icons) && w.icons.length > 0;
    let len = w.values.length, mx = len; w._ptr = false;
    for (const a of w.acts) {
      if (a.op === 'push') mx = Math.max(mx, ++len);
      else if (a.op === 'pop') len = Math.max(0, len - 1);
      else if (a.op === 'setAll') { len = arr(a.values).length; mx = Math.max(mx, len); }
      else if (a.op === 'ptr') w._ptr = true;
    }
    w._n = Math.max(mx, 1); w._idx = w.showIndex !== false;
  },
  size(w) {
    const C = 100, G = 14;
    w._top = (w.label ? 58 : 0) + (w._icons ? 88 : 0);
    const cells = w._n * (C + G) - G;
    w._w = Math.max(cells, w.label ? tw(w.label, { size: 34 }) + 10 : 0, 240);
    w._x0 = (w._w - cells) / 2;
    return [w._w, w._top + C + (w._idx ? 42 : 0) + (w._ptr ? 74 : 0)];
  },
  draw(w) {
    const C = 100, G = 14, B = w.base;
    let items = w.values.map((v, i) => ({ v, icon: w._icons ? w.icons[i] : null, hl: 'none', prev: 'none', u: 1, off: 0, dy: 0, a: 1, sc: 1 }));
    const ghosts = [], ptrs = {};
    const at = i => items[i - B];
    for (const a of w.acts) {
      if (t < a.t0) break;
      const p = eio(ap(a));
      if (a.op === 'hl') {
        const ids = a.index === 'all' ? items.map((_, i) => i + B) : arr(a.index);
        for (const i of ids) { const it = at(i); if (it) { it.prev = it.u >= 1 ? it.hl : it.prev; it.hl = a.color || 'yellow'; it.u = p; } }
      } else if (a.op === 'clear') {
        for (const it of items) if (it.hl !== 'none') { it.prev = it.hl; it.hl = 'none'; it.u = p; }
        if (a.ptr) for (const k in ptrs) ptrs[k].a = 1 - p;
      } else if (a.op === 'swap') {
        const i = a.i - B, j = a.j - B, A = items[i], Bq = items[j];
        if (A && Bq && i !== j) {
          items[i] = Bq; items[j] = A; const s = Math.sin(Math.PI * p) * C * .62;
          A.off += (i - j) * (1 - p); Bq.off += (j - i) * (1 - p); A.dy -= s; Bq.dy += s;
        }
      } else if (a.op === 'reorder') {
        let order = a.order;                                // order[j] = old index that moves to slot j
        if (!order && a.values) {
          const used = new Set(); order = arr(a.values).map(v => { const k = items.findIndex((it, i) => !used.has(i) && String(it.v) === String(v)); used.add(k); return k + B; });
        }
        if (order && order.length === items.length && order.every(i => at(i))) {
          const old = items.slice(); const s = Math.sin(Math.PI * p) * C * .55;
          items = order.map(i => old[i - B]);
          items.forEach((it, j) => { const from = old.indexOf(it); if (from !== j) { it.off += (from - j) * (1 - p); it.dy += (j % 2 ? s : -s); } });
        }
      } else if (a.op === 'set') {
        const it = at(a.i); if (it) { it.v = a.value; it.sc = 1 + .28 * Math.sin(Math.PI * p); }
      } else if (a.op === 'push') {
        items.push({ v: a.value, icon: a.icon, hl: a.color || 'none', prev: 'none', u: 1, off: (1 - p) * .9, dy: 0, a: p, sc: 1 });
      } else if (a.op === 'pop') {
        if (!items.length) continue;
        const front = (a.from || (w.kind === 'stack' ? 'back' : 'front')) === 'front';
        const g = front ? items.shift() : items.pop();
        if (p < 1) ghosts.push({ it: g, idx: front ? 0 : items.length, p });
        if (front) for (const it of items) it.off += (1 - p);
      } else if (a.op === 'setAll') {
        items = arr(a.values).map(v => ({ v, hl: 'none', prev: 'none', u: 1, off: 0, dy: 0, a: p, sc: 1 }));
      } else if (a.op === 'ptr') {
        const prev = ptrs[a.name], x = a.index - B;
        ptrs[a.name] = prev ? { x: lerp(prev.x, x, p), a: 1 } : { x, a: p };
      }
    }
    const top = w._top, x0 = w._x0;
    if (w.label) txt(w.label, 0, 26, { size: 34, align: 'left', color: INK });
    const cell = (it, idx, alpha, dy) => {
      const x = x0 + (idx + it.off) * (C + G), y = top + it.dy + (dy || 0);
      const c0 = pal(it.prev), c1 = pal(it.hl);
      ctx.save(); ctx.globalAlpha *= clamp(alpha); ctx.translate(x + C / 2, y + C / 2); ctx.scale(it.sc, it.sc);
      box(-C / 2, -C / 2, C, C, 20, mixHex(c0[0], c1[0], it.u), mixHex(c0[1], c1[1], it.u), 5);
      const s = String(it.v);
      if (isEmoji(s)) emoji(s, 0, 4, 58); else fitTxt(s, 0, 3, C - 16, { size: 46, color: c1[2], font: PLAIN });
      if (it.icon) emoji(it.icon, 0, -C / 2 - 46, 64);
      ctx.restore();
    };
    if (w._idx) for (let i = 0; i < w._n; i++) {
      let s = w.kind === 'array' ? String(i + B) : '';
      if (w.kind === 'queue' && items.length) s = i === 0 ? '队头' : (i === items.length - 1 ? '队尾' : '');
      if (w.kind === 'stack' && items.length) s = i === items.length - 1 ? '栈顶' : (i === 0 ? '栈底' : '');
      if (s) txt(s, x0 + i * (C + G) + C / 2, top + C + 24, { size: 26, color: '#7A8AAB', font: PLAIN });
    }
    if (!items.length && !ghosts.length) txt('（空）', w._w / 2, top + C / 2, { size: 32, color: '#9AA5B8' });
    items.forEach((it, i) => { if (it.off === 0 && it.dy === 0) cell(it, i, it.a); });
    items.forEach((it, i) => { if (it.off !== 0 || it.dy !== 0) cell(it, i, it.a); });   // moving cells on top
    for (const g of ghosts) cell(g.it, g.idx, 1 - g.p, -g.p * C * .8);
    const groups = {};
    for (const k in ptrs) { const r = Math.round(ptrs[k].x); (groups[r] = groups[r] || []).push(k); }
    for (const k in ptrs) {
      const q = ptrs[k], gr = groups[Math.round(q.x)], off = (gr.indexOf(k) - (gr.length - 1) / 2) * 46;
      const x = x0 + q.x * (C + G) + C / 2 + off, y = top + C + (w._idx ? 42 : 0);
      fade(q.a, () => { arrow(x, y + 34, x, y + 4, '#F0564A', 6); pill(x, y + 52, k, { size: 26, bg: '#F0564A', border: '#F0564A', color: '#fff', font: MONO, shadow: false, h: 38 }); });
    }
  },
};

WG.vars = {
  init(w) {
    w.items = arr(w.items).map(v => typeof v === 'object' ? { name: String(v.name), value: v.value } : { name: String(v), value: undefined });
    for (const a of w.acts) if (a.op === 'set' && !w.items.some(v => v.name === String(a.name))) w.items.push({ name: String(a.name), value: undefined });
  },
  size(w) {
    const n = Math.max(1, w.items.length); w._cols = Math.min(n, 6);
    return [w._cols * 190 - 24, Math.ceil(n / 6) * 142 - 12];
  },
  draw(w) {
    w.items.forEach((v, i) => {
      let val = v.value, bump = 0, flash = 0;
      for (const a of w.acts) { if (t < a.t0) break; if (a.op === 'set' && String(a.name) === v.name) { val = a.value; bump = Math.sin(Math.PI * eio(ap(a))); flash = 1 - clamp((t - a.t0 - a.dur) / .8); } }
      const x = (i % 6) * 190, y = Math.floor(i / 6) * 142;
      txt(v.name, x + 83, y + 22, { size: 30, color: INK, font: MONO });
      ctx.save(); ctx.translate(x + 83, y + 88); ctx.scale(1 + bump * .18, 1 + bump * .18);
      box(-83, -42, 166, 84, 18, mixHex('#EEF3FF', '#FFE27A', flash), mixHex('#B7C6E6', '#F2A900', flash), 5);
      fitTxt(val === undefined || val === null ? '?' : String(val), 0, 3, 146, { size: 42, color: val === undefined ? '#A9B4CC' : '#1F2D3D', font: PLAIN });
      ctx.restore();
    });
  },
};

const NOTE_STYLE = {
  pill: { size: 40, bg: '#FFFFFF', border: INK, color: INK },
  big: { size: 60, bg: '#FFE27A', border: '#F2A900', color: '#5A3D00' },
  formula: { size: 46, bg: '#FFFFFF', border: '#2D9CF0', color: '#12305C', font: PLAIN },
  warn: { size: 40, bg: '#FF6B5E', border: '#fff', color: '#fff' },
  good: { size: 40, bg: '#3DB54A', border: '#fff', color: '#fff' },
};
WG.note = {
  nocard: true,
  init(w) { w.text = String(w.text == null ? '' : w.text); w._st = NOTE_STYLE[w.style] || NOTE_STYLE.pill; },
  size(w) {
    const st = w._st; let mw = 0, ml = 1;
    for (const s of [w.text, ...w.acts.filter(a => a.op === 'text').map(a => String(a.text))]) {
      const ls = s.split('\n'); ml = Math.max(ml, ls.length);
      for (const l of ls) mw = Math.max(mw, tw(l, { size: st.size, font: st.font }));
    }
    w._lh = st.size * 1.4;
    return [Math.min(mw + st.size * 1.6, 1700), ml * w._lh + st.size * .9];
  },
  draw(w, bw, bh) {
    const st = w._st; let cur = w.text, u = 1;
    for (const a of w.acts) { if (t < a.t0) break; if (a.op === 'text') { cur = String(a.text); u = ap(a); } }
    pop(bw / 2, bh / 2, .35 + .65 * u, () => {
      const ls = cur.split('\n'); let mw = 0; for (const l of ls) mw = Math.max(mw, tw(l, { size: st.size, font: st.font }));
      const ww = Math.min(mw + st.size * 1.6, bw), hh = ls.length * w._lh + st.size * .9;
      ctx.save(); ctx.globalAlpha *= .16; box(-ww / 2, -hh / 2 + 7, ww, hh, 34, '#0B2A5B'); ctx.restore();
      box(-ww / 2, -hh / 2, ww, hh, Math.min(34, hh / 2), st.bg, st.border, 4);
      ls.forEach((l, i) => fitTxt(l, 0, (i - (ls.length - 1) / 2) * w._lh + 2, ww - st.size, { size: st.size, color: st.color, font: st.font }));
    });
  },
};

WG.io = {
  nocard: true,
  init(w) {
    w._in = String(w.input == null ? '' : w.input).replace(/\s+$/, '').split('\n');
    w._out0 = String(w.output == null ? '' : w.output);
    w._outAll = w._out0 + w.acts.filter(a => a.op === 'out').map(a => String(a.text)).join('');
  },
  size(w) {
    const fs = 30, cw = fs * .602;
    const ol = w._outAll.replace(/\s+$/, '').split('\n');
    const mc = Math.max(8, ...w._in.map(l => l.length), ...ol.map(l => l.length));
    w._wd = Math.min(Math.max(360, mc * cw + 64), 900); w._ih = w._in.length * 42 + 66; w._oh = Math.max(1, ol.length) * 42 + 66;
    return [w._wd, w._ih + w._oh + 18];
  },
  draw(w) {
    let out = w._out0, hl = -1, hu = 0;
    for (const a of w.acts) {
      if (t < a.t0) break;
      if (a.op === 'out') { const s = String(a.text); out += s.slice(0, Math.ceil(s.length * ap(a))); }
      else if (a.op === 'hlin') { hl = a.line - 1; hu = ap(a); }
    }
    const panel = (y, h, title, lines, isIn) => {
      box(0, y, w._wd, h, 20, '#14233F', '#9DB8FF', 4);
      txt(title, 22, y + 28, { size: 24, align: 'left', color: '#9DB8FF', font: PLAIN });
      lines.forEach((l, i) => {
        if (isIn && i === hl) { ctx.save(); ctx.globalAlpha *= hu; box(10, y + 50 + i * 42, w._wd - 20, 40, 8, 'rgba(255,226,122,.28)'); ctx.restore(); }
        fitTxt(l, 26, y + 71 + i * 42, w._wd - 50, { size: 30, align: 'left', color: isIn ? '#C8F7C5' : '#FFE27A', font: MONO, w: 'normal' });
      });
    };
    panel(0, w._ih, '输入', w._in, true);
    panel(w._ih + 18, w._oh, '输出', out.replace(/\s+$/, '').split('\n'), false);
  },
};
