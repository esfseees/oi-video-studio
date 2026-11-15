// ===== widgets (part C): code editor with typewriter + line highlight =====
let CODE_ACTS = [], CODE_ALL = true;                        // filled by main.js: all type / reveal actions in time order
const KW = {
  cpp: /^(int|long|double|float|char|bool|void|string|const|unsigned|signed|short|auto|struct|class|return|if|else|for|while|do|break|continue|switch|case|default|using|namespace|true|false|sizeof|typedef|static|template|typename|public|private|new|delete|nullptr|inline)$/,
  python: /^(def|return|if|elif|else|for|while|in|not|and|or|import|from|as|class|pass|break|continue|True|False|None|lambda|with|try|except|global|nonlocal|yield|is)$/,
};
const TOK = { kw: '#FF8FB1', id: '#E6EDF7', fn: '#7CC7FF', num: '#FFD66B', str: '#A8E6A1', com: '#8094B8', pre: '#C3A6FF', op: '#B8C7E6' };
function tokenize(line, lang) {
  const py = lang === 'python', out = [];
  if (!py && /^\s*#/.test(line)) return [[line, 'pre']];
  const re = py
    ? /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+)|(.)/g
    : /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b)|([A-Za-z_]\w*)|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1]) out.push([m[1], 'com']); else if (m[2]) out.push([m[2], 'str']); else if (m[3]) out.push([m[3], 'num']);
    else if (m[4]) out.push([m[4], KW[py ? 'python' : 'cpp'].test(m[4]) ? 'kw' : (/^\s*\(/.test(line.slice(re.lastIndex)) ? 'fn' : 'id')]);
    else out.push([m[0], 'op']);
  }
  return out;
}
const dispLen = s => { let n = 0; for (const ch of s) n += ch.charCodeAt(0) > 0x2E7F ? 2 : 1; return n; };
const lineRange = a => {
  const n = CODE.length; let [lo, hi] = arr(a.lines).length ? arr(a.lines) : [1, n];
  lo = clamp(Math.round(lo) || 1, 1, n); hi = clamp(Math.round(hi == null ? lo : hi) || lo, lo, n); return [lo, hi];
};

WG.code = {
  nocard: true,
  init() { },
  size() { return [960, 800]; },
  draw(w) {
    const BW = 960, BH = 800, n = CODE.length, lang = SB.lang === 'python' ? 'python' : 'cpp';
    const maxLen = Math.max(24, ...CODE.map(dispLen));
    const fs = clamp((BW - 100) / (maxLen * .602), 17, 28), LH = fs * 1.56, rows = Math.floor((BH - 66) / LH);
    const full = new Array(n + 2).fill(CODE_ALL ? 1 : 0), part = {};
    let cur = null;
    for (const a of CODE_ACTS) {
      if (t < a.t0) break;
      const [lo, hi] = lineRange(a);
      if (a.op === 'reveal' || ap(a) >= 1) { for (let i = lo; i <= hi; i++) full[i] = 1; continue; }
      let total = 0; for (let i = lo; i <= hi; i++) total += CODE[i - 1].length + 1;
      let k = Math.floor(ap(a) * total);
      for (let i = lo; i <= hi; i++) {
        const L = CODE[i - 1].length + 1;
        if (k >= L) { full[i] = 1; k -= L; } else { if (!full[i]) part[i] = k; cur = { line: i, col: k }; break; }
      }
    }
    const maxTop = Math.max(0, n - rows);
    const tgt = (lo, hi) => clamp(hi - lo + 1 <= rows ? lo - 1 - Math.floor((rows - (hi - lo + 1)) / 2) : lo - 1, 0, maxTop);
    let top = 0, hl = null, hu = 0, first = true;
    for (const a of w.acts) {
      if (!['type', 'focus', 'reveal'].includes(a.op)) continue;
      const [lo, hi] = lineRange(a);
      let g = tgt(lo, hi);
      if (a.op === 'type' && hi - lo + 1 > rows) g = clamp(lo + Math.floor(ap(a) * (hi - lo + 1)) - rows + 3, lo - 1, maxTop);
      if (first) { top = tgt(lo, hi); first = false; }      // start already scrolled to the first target
      if (t < a.t0) break;
      top = lerp(top, g, eio(pr(a.t0, .5)));
      if (a.op === 'focus') { hl = [lo, hi]; hu = pr(a.t0, .3); }
      else if (a.op === 'type') { hl = ap(a) < 1 && cur ? [cur.line, cur.line] : [lo, hi]; hu = 1; }
    }
    // window chrome
    ctx.save(); ctx.globalAlpha *= .22; box(0, 10, BW, BH, 26, '#000'); ctx.restore();
    box(0, 0, BW, BH, 26, '#111C36', '#9DB8FF', 4);
    ctx.fillStyle = '#1B2A4E'; rr(2, 2, BW - 4, 50, 24); ctx.fill(); ctx.fillRect(2, 30, BW - 4, 22);
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(30 + i * 26, 27, 8, 0, 7); ctx.fill(); });
    txt(lang === 'python' ? 'main.py' : 'main.cpp', BW / 2, 28, { size: 22, color: '#9DB8FF', font: MONO, w: 'normal' });
    ctx.save(); ctx.beginPath(); ctx.rect(4, 54, BW - 8, BH - 60); ctx.clip();
    const y0 = 62 + LH / 2;
    for (let i = Math.max(1, Math.floor(top)); i <= Math.min(n, Math.ceil(top) + rows + 1); i++) {
      const y = y0 + (i - 1 - top) * LH, vis = full[i] || part[i] != null;
      if (hl && i >= hl[0] && i <= hl[1] && vis) {
        ctx.save(); ctx.globalAlpha *= hu; ctx.fillStyle = 'rgba(255,226,122,.17)'; ctx.fillRect(4, y - LH / 2, BW - 8, LH);
        ctx.fillStyle = '#FFD66B'; ctx.fillRect(4, y - LH / 2, 6, LH); ctx.restore();
      }
      if (!vis) continue;
      txt(i, 58, y + 1, { size: fs * .82, align: 'right', color: '#5C6F99', font: MONO, w: 'normal' });
      let x = 78, left = full[i] ? Infinity : part[i];
      ctx.font = `normal ${fs}px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const [s, kind] of tokenize(CODE[i - 1], lang)) {
        if (left <= 0) break;
        const piece = s.length > left ? s.slice(0, left) : s; left -= piece.length;
        ctx.fillStyle = TOK[kind]; ctx.fillText(piece, x, y + 1); x += ctx.measureText(piece).width;
      }
      if (cur && cur.line === i && Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = '#FFD66B'; ctx.fillRect(x + 2, y - fs * .55, fs * .12 + 2, fs * 1.1); }
    }
    ctx.restore();
  },
};
