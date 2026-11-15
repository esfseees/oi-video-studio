// ===== widgets (part B): grid, graph / tree =====
const stag = (a, i, n) => clamp((t - a.t0 - i * (n > 1 ? Math.min(.12, .9 / n) : 0)) / .35);

WG.grid = {
  init(w) {
    let rows = w.rows;
    if (!Array.isArray(rows) || !rows.length) { const [R, C] = arr(w.size).length === 2 ? w.size : [3, 3]; rows = Array.from({ length: R }, () => Array(C).fill('')); }
    const strs = rows.every(r => typeof r === 'string');
    const walls = w.walls == null ? '#' : String(w.walls);
    w._cells = rows.map(r => (strs ? [...r] : arr(r)).map(v => ({ v: v == null ? '' : String(v), wall: strs && walls.includes(String(v)) })));
    w._R = w._cells.length; w._C = Math.max(1, ...w._cells.map(r => r.length));
    w._show = w.showText != null ? !!w.showText : !strs;
    w._actors = arr(w.actors).filter(a => a && a.name && Array.isArray(a.at));
  },
  size(w) { w._top = (w.label ? 58 : 0) + 40; return [44 + w._C * 100 - 8, w._top + w._R * 100 - 8]; },
  draw(w) {
    const S = 100, C = 92, ox = 44, oy = w._top;
    const st = w._cells.map(r => r.map(c => ({ ...c, hl: 'none', prev: 'none', u: 1, tu: 1 })));
    const actors = {}, lines = [];
    for (const a of w._actors) actors[a.name] = { icon: a.icon || '🙂', r: a.at[0], c: a.at[1], a: 1 };
    const cell = p => (st[p[0] - 1] || [])[p[1] - 1];
    for (const a of w.acts) {
      if (t < a.t0) break;
      const p = eio(ap(a));
      if (a.op === 'mark') {
        const cs = arr(a.cells); cs.forEach((q, i) => { const c = cell(q); if (c) { c.prev = c.u >= 1 ? c.hl : c.prev; c.hl = a.color || 'yellow'; c.u = stag(a, i, cs.length); } });
      } else if (a.op === 'num' || a.op === 'set') {
        const cs = arr(a.cells); cs.forEach((q, i) => { const c = cell(q); if (c) { c.v = String(q[2]); c.txt = true; c.tu = stag(a, i, cs.length); if (a.color) { c.prev = c.hl; c.hl = a.color; c.u = c.tu; } } });
      } else if (a.op === 'actor') {
        if (Array.isArray(a.at)) actors[a.name] = { icon: a.icon || (actors[a.name] || {}).icon || '🙂', r: a.at[0], c: a.at[1], a: p };
      } else if (a.op === 'move') {
        const ac = actors[a.name], path = arr(a.path).length ? a.path : (a.to ? [a.to] : []);
        if (ac && path.length) {
          const pts = [[ac.r, ac.c], ...path], f = ap(a) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = eio(f - i);
          ac.r = lerp(pts[i][0], pts[i + 1][0], u); ac.c = lerp(pts[i][1], pts[i + 1][1], u); ac.hop = Math.sin(Math.PI * (f - i));
          if (ap(a) >= 1) { ac.r = pts[pts.length - 1][0]; ac.c = pts[pts.length - 1][1]; ac.hop = 0; }
        }
      } else if (a.op === 'line') {
        if (Array.isArray(a.from) && Array.isArray(a.to)) lines.push({ f: a.from, to: a.to, color: a.color || 'orange', p, a: 1 });
      } else if (a.op === 'clear') {
        for (const r of st) for (const c of r) if (c.hl !== 'none') { c.prev = c.hl; c.hl = 'none'; c.u = p; }
        for (const l of lines) l.a *= 1 - p;
        if (a.what === 'all') for (const r of st) for (const c of r) if (c.txt) { c.tu = 1 - p; if (p >= 1) { c.v = ''; } }
      }
    }
    if (w.label) txt(w.label, 0, 26, { size: 34, align: 'left', color: INK });
    for (let c = 0; c < w._C; c++) txt(c + 1, ox + c * S + C / 2, oy - 20, { size: 26, color: '#7A8AAB', font: PLAIN });
    for (let r = 0; r < w._R; r++) txt(r + 1, 16, oy + r * S + C / 2, { size: 26, color: '#7A8AAB', font: PLAIN });
    st.forEach((row, r) => row.forEach((c, k) => {
      const x = ox + k * S, y = oy + r * S;
      if (c.wall) {
        box(x, y, C, C, 18, '#3E4F78', '#2A3857', 4);
        ctx.fillStyle = 'rgba(255,255,255,.10)'; rr(x + 10, y + 10, C - 20, 22, 10); ctx.fill();
        if (w._show) txt(c.v, x + C / 2, y + C / 2 + 4, { size: 40, color: '#C9D5F2', font: PLAIN });
        return;
      }
      const c0 = pal(c.prev), c1 = pal(c.hl), sc = c.u < 1 ? 1 + .12 * Math.sin(Math.PI * c.u) : 1;
      ctx.save(); ctx.translate(x + C / 2, y + C / 2); ctx.scale(sc, sc);
      box(-C / 2, -C / 2, C, C, 18, mixHex(c0[0], c1[0], c.u), mixHex(c0[1], c1[1], c.u), 4);
      if ((w._show || c.txt) && c.v !== '' && c.v !== '.' && c.v !== ' ') pop(0, 0, c.txt ? c.tu : 1, () => fitTxt(c.v, 0, 3, C - 14, { size: 44, color: c1[2], font: PLAIN }));
      ctx.restore();
    }));
    const ctr = p => [ox + (p[1] - 1) * S + C / 2, oy + (p[0] - 1) * S + C / 2];
    for (const l of lines) {
      const [x1, y1] = ctr(l.f), [x2, y2] = ctr(l.to);
      ctx.save(); ctx.globalAlpha *= .8 * l.a; ctx.strokeStyle = pal(l.color)[1]; ctx.lineWidth = 12; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(lerp(x1, x2, l.p), lerp(y1, y2, l.p)); ctx.stroke(); ctx.restore();
    }
    for (const k in actors) {
      const ac = actors[k], [x, y] = ctr([ac.r, ac.c]);
      pop(x, y - (ac.hop || 0) * 16, ac.a, () => {
        if (isEmoji(ac.icon)) emoji(ac.icon, 0, 4, 62);
        else { ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fillStyle = '#F0564A'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke(); fitTxt(ac.icon, 0, 2, 54, { size: 34, color: '#fff', font: PLAIN }); }
      });
    }
  },
};

WG.graph = {
  init(w) {
    w._nodes = arr(w.nodes).map(n => typeof n === 'object' && n ? { id: String(n.id), label: n.label == null ? String(n.id) : String(n.label), x: n.x, y: n.y } : { id: String(n), label: String(n) });
    const ids = new Set(w._nodes.map(n => n.id));
    w._edges = arr(w.edges).map(e => Array.isArray(e) ? { a: String(e[0]), b: String(e[1]), w: e[2] } : { a: String(e.from), b: String(e.to), w: e.w })
      .filter(e => ids.has(e.a) && ids.has(e.b));
    const n = w._nodes.length, BW = 820, BH = 540, M = 60;
    w._pos = {};
    const manual = n > 0 && w._nodes.every(v => typeof v.x === 'number' && typeof v.y === 'number');
    if (manual) for (const v of w._nodes) w._pos[v.id] = [M + clamp(v.x) * (BW - 2 * M), M + clamp(v.y) * (BH - 2 * M)];
    else if (w.layout === 'tree' && n) {
      const adj = {}; for (const v of w._nodes) adj[v.id] = [];
      for (const e of w._edges) { adj[e.a].push(e.b); if (!w.directed) adj[e.b].push(e.a); }
      const root = ids.has(String(w.root)) ? String(w.root) : w._nodes[0].id, dep = {}, kids = {}, xs = {}; let leaf = 0, maxd = 0;
      const seen = new Set([root]);
      const walk = (u, d) => {
        dep[u] = d; maxd = Math.max(maxd, d); kids[u] = adj[u].filter(v => !seen.has(v)); kids[u].forEach(v => seen.add(v));
        for (const v of kids[u]) walk(v, d + 1);
        xs[u] = kids[u].length ? kids[u].reduce((s, v) => s + xs[v], 0) / kids[u].length : leaf++;
      };
      walk(root, 0);
      for (const v of w._nodes) if (!seen.has(v.id)) { dep[v.id] = maxd; xs[v.id] = leaf++; }
      for (const v of w._nodes) w._pos[v.id] = [leaf > 1 ? M + xs[v.id] / (leaf - 1) * (BW - 2 * M) : BW / 2, maxd ? M + dep[v.id] / maxd * (BH - 2 * M) : BH / 2];
    } else w._nodes.forEach((v, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, n); w._pos[v.id] = [BW / 2 + Math.cos(a) * (BW / 2 - M - 20), BH / 2 + Math.sin(a) * (BH / 2 - M)]; });
  },
  size(w) { w._top = w.label ? 50 : 0; return [820, 540 + w._top]; },
  draw(w) {
    const ns = {}, es = {}; const key = (a, b) => w.directed ? a + '>' + b : [a, b].sort().join('|');
    for (const v of w._nodes) ns[v.id] = { hl: 'none', prev: 'none', u: 1, tag: null, tu: 0 };
    for (const a of w.acts) {
      if (t < a.t0) break;
      const p = eio(ap(a));
      if (a.op === 'hl') {
        for (const id of arr(a.nodes)) { const s = ns[String(id)]; if (s) { s.prev = s.u >= 1 ? s.hl : s.prev; s.hl = a.color || 'yellow'; s.u = p; } }
        for (const e of arr(a.edges)) if (Array.isArray(e)) es[key(String(e[0]), String(e[1]))] = { color: a.color || 'yellow', u: p };
      } else if (a.op === 'set') { const s = ns[String(a.node)]; if (s) { s.tag = String(a.text); s.tu = p; } }
      else if (a.op === 'clear') { for (const k in ns) if (ns[k].hl !== 'none') { ns[k].prev = ns[k].hl; ns[k].hl = 'none'; ns[k].u = p; } for (const k in es) es[k].u *= 1 - p; }
    }
    ctx.save(); ctx.translate(0, w._top);
    if (w.label) txt(w.label, 0, 24 - w._top, { size: 34, align: 'left', color: INK });
    const R = 40;
    for (const e of w._edges) {
      const [x1, y1] = w._pos[e.a], [x2, y2] = w._pos[e.b], h = es[key(e.a, e.b)], d = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / d, uy = (y2 - y1) / d, col = h ? mixHex('#9AA9C9', pal(h.color)[1], h.u) : '#9AA9C9', lw = h ? 5 + 4 * h.u : 5;
      if (w.directed) arrow(x1 + ux * R, y1 + uy * R, x2 - ux * (R + 4), y2 - uy * (R + 4), col, lw);
      else { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1 + ux * R, y1 + uy * R); ctx.lineTo(x2 - ux * R, y2 - uy * R); ctx.stroke(); }
      if (e.w != null && e.w !== '') { const mx = (x1 + x2) / 2 - uy * 22, my = (y1 + y2) / 2 + ux * 22; box(mx - 24, my - 19, 48, 38, 12, '#fff'); fitTxt(e.w, mx, my + 1, 42, { size: 26, color: '#C4541A', font: PLAIN }); }
    }
    for (const v of w._nodes) {
      const [x, y] = w._pos[v.id], s = ns[v.id], c0 = pal(s.prev), c1 = pal(s.hl), sc = s.u < 1 ? 1 + .15 * Math.sin(Math.PI * s.u) : 1;
      ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fillStyle = mixHex(c0[0], c1[0], s.u); ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = mixHex(c0[1], c1[1], s.u); ctx.stroke();
      fitTxt(v.label, 0, 2, R * 1.6, { size: 36, color: c1[2], font: PLAIN });
      ctx.restore();
      if (s.tag != null) pop(x + R * .9, y - R * .95, s.tu, () => pill(0, 0, s.tag, { size: 26, bg: '#F0564A', border: '#fff', color: '#fff', font: PLAIN, shadow: false, h: 40, lw: 3 }));
    }
    ctx.restore();
  },
};
