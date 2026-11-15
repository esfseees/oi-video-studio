// OI Video Studio — local web server (no framework). Start: node server.js   then open http://127.0.0.1:5178
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
if (process.platform !== 'win32') process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(path.delimiter);
const llm = require('./lib/llm');
const P = require('./lib/pipeline');

const PORT = Number(process.env.PORT || 5178), HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public'), CFG_FILE = path.join(P.DATA, 'config.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.srt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon' };

// ---------- model config (API keys stay in data/config.json on this machine, never sent back to the page) ----------
const readCfg = () => { try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (e) { return { active: 'openai', providers: {} }; } };
const writeCfg = c => { fs.mkdirSync(P.DATA, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2), { mode: 0o600 }); };
function modelCfg(id, override = {}) {                       // saved settings for a provider, optionally overridden by form values
  const c = readCfg(), pid = id || c.active, pv = llm.provider(pid), s = (c.providers || {})[pid] || {};
  return { provider: pid, baseUrl: override.baseUrl != null && override.baseUrl !== '' ? override.baseUrl : (s.baseUrl || pv.baseUrl), model: override.model || s.model || pv.models[0] || '', apiKey: override.apiKey || s.apiKey || '' };
}
function publicCfg() {
  const c = readCfg(), out = { active: c.active, providers: {} };
  for (const p of llm.PROVIDERS) { const s = (c.providers || {})[p.id] || {}; out.providers[p.id] = { baseUrl: s.baseUrl || p.baseUrl, model: s.model || p.models[0] || '', hasKey: !!s.apiKey, keyTail: s.apiKey ? s.apiKey.slice(-4) : '' }; }
  return out;
}

// ---------- access password (needed whenever other computers can reach this server) ----------
const ACCESS = process.env.ACCESS_PASSWORD || '', LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
if (!LOOPBACK && !ACCESS) { console.error('为了安全，开放给其他电脑访问时必须设置访问密码（环境变量 ACCESS_PASSWORD）。'); process.exit(1); }
const TOKEN = ACCESS ? crypto.createHmac('sha256', ACCESS).update('oi-video-studio-session').digest('hex') : '';
const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const authed = req => !ACCESS || (req.headers.cookie || '').split(/;\s*/).includes('oivs=' + TOKEN);
const fails = new Map();                                    // ip -> [timestamps] of wrong passwords
async function login(req, res) {
  const ip = req.socket.remoteAddress || '', now = Date.now(), list = (fails.get(ip) || []).filter(x => now - x < 600000);
  if (list.length >= 10) return send(res, 429, { error: '密码错误次数太多，请 10 分钟后再试' });
  const b = await readBody(req, 4096);
  if (ACCESS && crypto.timingSafeEqual(sha(b.password), sha(ACCESS))) {
    fails.delete(ip);
    res.writeHead(200, { 'content-type': MIME['.json'], 'set-cookie': `oivs=${TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
    return res.end(JSON.stringify({ ok: true }));
  }
  list.push(now); fails.set(ip, list);
  await new Promise(r => setTimeout(r, 800));
  send(res, 401, { error: '访问密码不对' });
}

// ---------- helpers ----------
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' }); res.end(b); };
function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > limit) { reject(new Error('上传内容太大')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('请求格式有误')); } });
    req.on('error', reject);
  });
}
function sendFile(req, res, file, extraHeaders = {}) {
  let st; try { st = fs.statSync(file); } catch (e) { res.writeHead(404); return res.end('not found'); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {                                              // byte ranges so the video can seek
    let a = range[1] === '' ? Math.max(0, st.size - Number(range[2])) : Number(range[1]), b = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
    if (a >= st.size || a > b) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    b = Math.min(b, st.size - 1);
    res.writeHead(206, { 'content-type': type, 'content-length': b - a + 1, 'content-range': `bytes ${a}-${b}/${st.size}`, 'accept-ranges': 'bytes', ...extraHeaders });
    return fs.createReadStream(file, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', ...extraHeaders });
  fs.createReadStream(file).pipe(res);
}
const jobView = j => ({ ...j, input: { ...j.input }, hasVideo: j.status === 'done' });
const charView = c => ({ id: c.id, name: c.name, builtin: !!c.builtin, url: '/char/' + c.id });
const clampNum = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };

// ---------- routes ----------
async function api(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean), m = req.method;           // ['api', ...]
  if (seg[1] === 'state' && m === 'GET') {
    return send(res, 200, { providers: llm.PROVIDERS, config: publicCfg(), characters: P.listChars().map(charView), voices: P.VOICES.map(v => ({ id: v.id, name: v.name })), jobs: P.listJobs().map(jobView),
      demo: { code: fs.readFileSync(path.join(__dirname, 'builtin', 'demo_code.cpp'), 'utf8'), problem: fs.readFileSync(path.join(__dirname, 'builtin', 'demo_problem.txt'), 'utf8') } });
  }
  if (seg[1] === 'config' && m === 'POST') {
    const b = await readBody(req), c = readCfg(), pv = llm.provider(b.provider); c.providers = c.providers || {};
    const s = c.providers[pv.id] || {};
    s.baseUrl = String(b.baseUrl || '').trim() || pv.baseUrl; s.model = String(b.model || '').trim();
    if (b.apiKey) s.apiKey = String(b.apiKey).trim(); if (b.clearKey) delete s.apiKey;
    c.providers[pv.id] = s; c.active = pv.id; writeCfg(c);
    return send(res, 200, { ok: true, config: publicCfg() });
  }
  if (seg[1] === 'models' && m === 'POST') { const b = await readBody(req); return send(res, 200, { models: await llm.listModels(modelCfg(b.provider, b)) }); }
  if (seg[1] === 'test' && m === 'POST') {
    const b = await readBody(req), cfg = modelCfg(b.provider, b), t0 = Date.now();
    const out = await llm.chat(cfg, { system: '你是连通性测试助手。', user: '请只回复两个字：正常', timeoutMs: 60000 });
    return send(res, 200, { ok: true, reply: out.trim().slice(0, 60), ms: Date.now() - t0, model: cfg.model });
  }
  if (seg[1] === 'characters') {
    if (m === 'POST') { const b = await readBody(req); return send(res, 200, { character: charView(P.addChar(b.name, b.dataUrl)) }); }
    if (m === 'DELETE' && seg[2]) { P.removeChar(seg[2]); return send(res, 200, { ok: true }); }
  }
  if (seg[1] === 'jobs') {
    if (m === 'GET' && !seg[2]) return send(res, 200, { jobs: P.listJobs().map(jobView) });
    if (m === 'POST' && !seg[2]) {
      const b = await readBody(req);
      let code = String(b.code || ''), problemText = String(b.problemText || ''), storyboard = null;
      if (b.demo) { code = fs.readFileSync(path.join(__dirname, 'builtin', 'demo_code.cpp'), 'utf8'); storyboard = JSON.parse(fs.readFileSync(path.join(__dirname, 'builtin', 'demo_storyboard.json'), 'utf8')); }
      else if (b.storyboard) { try { storyboard = typeof b.storyboard === 'string' ? JSON.parse(b.storyboard) : b.storyboard; } catch (e) { throw new Error('分镜 JSON 格式有误：' + e.message); } }
      if (!code.trim()) throw new Error('请填写答案代码');
      const problemUrl = String(b.problemUrl || '').trim(), problemImage = /^data:image\//.test(b.problemImage || '') ? b.problemImage : null;
      const cfg = modelCfg();
      if (!storyboard) {
        if (!problemText.trim() && !problemUrl && !problemImage) throw new Error('请提供题目：粘贴文字、上传截图或填写链接，至少一种');
        const pv = llm.provider(cfg.provider);
        if (!cfg.model || (!cfg.apiKey && !pv.noKey)) throw new Error('还没有配置 AI 模型，请先在「AI 模型配置」里填写并保存');
      }
      const input = { title: String(b.title || '').slice(0, 30), lang: b.lang === 'python' ? 'python' : 'cpp', age: clampNum(b.age, 6, 18, 12), minutes: clampNum(b.minutes, 1, 8, 5),
        characterId: String(b.characterId || 'xiaotuling'), voiceId: String(b.voiceId || 'robot'), theme: String(b.theme || 'auto'), problemUrl, hasImage: !!problemImage, hasText: !!problemText.trim(),
        source: b.demo ? 'demo' : (storyboard ? 'storyboard' : 'ai') };
      return send(res, 200, { job: jobView(P.createJob(input, { code, problemText, problemImage, storyboard }, cfg)) });
    }
    const id = seg[2]; if (!/^[\w-]+$/.test(id || '')) throw new Error('任务不存在');
    if (m === 'GET' && !seg[3]) return send(res, 200, { job: jobView(P.loadJob(id)) });
    if (m === 'GET' && seg[3] === 'detail') {
      const d = P.jobDir(id), rd = f => { try { return fs.readFileSync(path.join(d, f), 'utf8'); } catch (e) { return ''; } };
      return send(res, 200, { job: jobView(P.loadJob(id)), storyboard: rd('storyboard.json'), code: rd('code.txt'), problem: rd('problem.txt') });
    }
    if (m === 'POST' && seg[3] === 'share') {                // upload the finished video to NOS, only on an explicit click
      const sc = readCfg().share || {};
      return send(res, 200, { job: jobView(await P.shareJob(id, { endpoint: sc.endpoint, cdn: sc.cdn !== false })) });
    }
    if (m === 'POST' && seg[3] === 'cancel') { P.cancelJob(id); return send(res, 200, { ok: true }); }
    if (m === 'DELETE') { P.deleteJob(id); return send(res, 200, { ok: true }); }
  }
  send(res, 404, { error: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method !== 'GET' && req.headers.origin) {         // only this site's own pages may change anything
      let oh = ''; try { oh = new URL(req.headers.origin).host; } catch (e) { /* bad origin */ }
      if (oh !== req.headers.host) return send(res, 403, { error: '跨站请求被拒绝' });
    }
    if (url.pathname === '/api/login' && req.method === 'POST') return await login(req, res);
    if (!authed(req) && url.pathname !== '/char/xiaotuling') {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: '请先输入访问密码', needLogin: true });
      if (req.method === 'GET' && !path.extname(url.pathname)) return sendFile(req, res, path.join(PUBLIC, 'login.html'), { 'cache-control': 'no-store' });
      res.writeHead(401); return res.end();
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (seg[0] === 'media' && /^[\w-]+$/.test(seg[1] || '') && ['video.mp4', 'subtitles.srt', 'cover.jpg', 'storyboard.json'].includes(seg[2])) {
      const h = {};
      if (url.searchParams.get('dl')) {
        let title = '讲解视频'; try { title = P.loadJob(seg[1]).title || title; } catch (e) { /* keep default */ }
        const name = title.replace(/[\\/:*?"<>|]/g, '_') + (seg[2] === 'video.mp4' ? '-动画讲解.mp4' : seg[2] === 'subtitles.srt' ? '-动画讲解.srt' : '-分镜.json');
        h['content-disposition'] = `attachment; filename="video${path.extname(seg[2])}"; filename*=UTF-8''${encodeURIComponent(name)}`;
      }
      return sendFile(req, res, path.join(P.jobDir(seg[1]), seg[2]), h);
    }
    if (seg[0] === 'char' && seg[1]) { const c = P.listChars().find(x => x.id === seg[1]); if (c) return sendFile(req, res, c.file, { 'cache-control': 'max-age=3600' }); }
    const rel = seg.length ? seg.join('/') : 'index.html', file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    return sendFile(req, res, file, { 'cache-control': 'no-cache' });
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: String(e.message || e) }); else res.end();
  }
});

P.recoverOnStart();
server.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用：网站可能已经在运行，直接打开 http://127.0.0.1:${PORT} 即可。` : '网站启动失败：' + e.message);
  process.exit(e.code === 'EADDRINUSE' ? 3 : 1);
});
server.listen(PORT, HOST, () => {
  console.log(`信奥讲解视频工坊已启动： http://${LOOPBACK ? HOST : 'localhost'}:${PORT}` + (ACCESS ? '（已开启访问密码）' : ''));
  if (process.send) process.send('ready');
});
