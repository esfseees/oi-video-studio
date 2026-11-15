// Job pipeline: problem -> storyboard (AI) -> narration -> frames -> mp4. One job runs at a time.
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const llm = require('./llm');
const SBD = require('./storyboard');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.OIVS_DATA_DIR ? path.resolve(process.env.OIVS_DATA_DIR) : path.join(ROOT, 'data');
const JOBS = path.join(DATA, 'jobs'), CHARS = path.join(DATA, 'characters');
const FFMPEG = process.env.OIVS_FFMPEG || 'ffmpeg';
const PY = process.env.OIVS_PYTHON || (process.platform === 'win32' ? path.join(ROOT, '.venv', 'Scripts', 'python.exe') : path.join(ROOT, '.venv', 'bin', 'python'));
const USE_PY_VOICE = process.env.OIVS_VOICE_BACKEND === 'python' && fs.existsSync(PY);
const VOICES = [
  { id: 'robot', name: '可爱小机器人', voice: 'zh-CN-YunxiaNeural', rate: '+6%', pitch: '+18Hz', fx: true },
  { id: 'kid', name: '童声', voice: 'zh-CN-YunxiaNeural', rate: '+4%', pitch: '+10Hz', fx: false },
  { id: 'girl', name: '活泼女声', voice: 'zh-CN-XiaoyiNeural', rate: '+4%', pitch: '+0Hz', fx: false },
  { id: 'teacher_f', name: '女老师', voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', pitch: '+0Hz', fx: false },
  { id: 'teacher_m', name: '男老师', voice: 'zh-CN-YunxiNeural', rate: '+0%', pitch: '+0Hz', fx: false },
];
const BUILTIN_CHARS = [{ id: 'xiaotuling', name: '小图灵机器人', file: path.join(ROOT, 'builtin', 'xiaotuling.png'), builtin: true,
  mouth: { x: 204.5, y: 177.5, r: 10.5, bg: 'rgb(2,125,255)', color: '#C4F8FF' } }];

// ---------- characters ----------
const charIndex = () => { try { return JSON.parse(fs.readFileSync(path.join(CHARS, 'index.json'), 'utf8')); } catch (e) { return []; } };
const saveCharIndex = l => { fs.mkdirSync(CHARS, { recursive: true }); fs.writeFileSync(path.join(CHARS, 'index.json'), JSON.stringify(l, null, 2)); };
const listChars = () => [...BUILTIN_CHARS, ...charIndex().map(c => ({ ...c, file: path.join(CHARS, c.fileName) }))];
function addChar(name, dataUrl) {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('请上传 PNG、JPG、WebP 或 GIF 图片');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('图片不能超过 8MB');
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), fileName = id + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.mkdirSync(CHARS, { recursive: true }); fs.writeFileSync(path.join(CHARS, fileName), buf);
  const l = charIndex(), c = { id, name: String(name || '我的角色').slice(0, 16), fileName }; l.push(c); saveCharIndex(l);
  return c;
}
function removeChar(id) {
  const l = charIndex(), c = l.find(x => x.id === id); if (!c) throw new Error('只能删除自己上传的角色');
  saveCharIndex(l.filter(x => x.id !== id)); fs.rmSync(path.join(CHARS, c.fileName), { force: true });
}

// ---------- jobs ----------
const jobDir = id => path.join(JOBS, id);
const loadJob = id => JSON.parse(fs.readFileSync(path.join(jobDir(id), 'job.json'), 'utf8'));
const saveJob = j => fs.writeFileSync(path.join(jobDir(j.id), 'job.json'), JSON.stringify(j, null, 2));
function listJobs() {
  if (!fs.existsSync(JOBS)) return [];
  return fs.readdirSync(JOBS).map(id => { try { return loadJob(id); } catch (e) { return null; } }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}
const queue = []; let current = null;                        // current: { id, procs:Set, cancelled }

function createJob(input, files, modelCfg) {
  const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
  const dir = jobDir(id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'code.txt'), files.code);
  fs.writeFileSync(path.join(dir, 'problem.txt'), files.problemText || '');
  if (files.problemImage) fs.writeFileSync(path.join(dir, 'problem_image.txt'), files.problemImage);
  if (files.storyboard) fs.writeFileSync(path.join(dir, 'storyboard_input.json'), JSON.stringify(files.storyboard));
  const ch = listChars().find(c => c.id === input.characterId) || BUILTIN_CHARS[0];
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify({ name: ch.name, file: ch.file, mouth: ch.mouth || null }));
  const job = { id, createdAt: Date.now(), title: input.title || '新讲解视频', status: 'queued', stage: 'queued', stageLabel: '排队中', progress: 0, input,
    model: files.storyboard ? null : { provider: modelCfg.provider, model: modelCfg.model }, warnings: [] };
  saveJob(job); queue.push({ id, modelCfg }); setImmediate(pump);
  return job;
}

function pump() {
  if (current || !queue.length) return;
  const { id, modelCfg } = queue.shift(); current = { id, procs: new Set(), cancelled: false };
  runJob(id, modelCfg).finally(() => { current = null; pump(); });
}
function cancelJob(id) {
  const i = queue.findIndex(q => q.id === id);
  if (i >= 0) { queue.splice(i, 1); const j = loadJob(id); Object.assign(j, { status: 'failed', error: '已取消' }); saveJob(j); return; }
  if (current && current.id === id) { current.cancelled = true; for (const p of current.procs) p.kill('SIGKILL'); }
}
function deleteJob(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('bad id');
  cancelJob(id); fs.rmSync(jobDir(id), { recursive: true, force: true });
}
function recoverOnStart() {
  for (const j of listJobs()) if (j.status === 'queued' || j.status === 'running') { Object.assign(j, { status: 'failed', error: '服务重启，任务被中断，请重新生成' }); saveJob(j); }
}

function run(cmd, args, onLine) {                              // spawn tied to the current job; resolves with output
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT }); current.procs.add(p);
    let out = '', err = '', buf = '';
    p.stdout.on('data', d => { out += d; buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (onLine) onLine(l); } });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { current.procs.delete(p); reject(new Error(`无法运行 ${path.basename(cmd)}：${e.message}`)); });
    p.on('close', code => { current.procs.delete(p); if (current.cancelled) reject(new Error('已取消')); else if (code === 0) resolve(out); else reject(new Error((out + err).trim().split('\n').slice(-3).join(' ') || `${path.basename(cmd)} 退出码 ${code}`)); });
  });
}

async function fetchPage(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('题目链接必须以 http:// 或 https:// 开头');
  const browser = await require('./browser').launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { });
    const text = (await page.evaluate(() => document.title + '\n' + document.body.innerText)).replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 120) throw new Error('这个链接没有读到题目内容（可能需要登录）。请改用粘贴文字或上传截图。');
    return text.slice(0, 12000);
  } catch (e) {
    throw new Error(/没有读到/.test(e.message) ? e.message : '打开题目链接失败：' + e.message.split('\n')[0]);
  } finally { await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]); }
}

async function runJob(id, modelCfg) {
  const dir = jobDir(id), job = loadJob(id), rd = f => fs.readFileSync(path.join(dir, f), 'utf8'), has = f => fs.existsSync(path.join(dir, f));
  const upd = patch => { Object.assign(job, patch); saveJob(job); };
  const stage = (s, label, progress) => { if (current.cancelled) throw new Error('已取消'); upd({ status: 'running', stage: s, stageLabel: label, progress }); };
  try {
    const code = rd('code.txt'), codeLines = code.replace(/\s+$/, '').split('\n').length, inp = job.input;
    let raw;
    if (has('storyboard_input.json')) raw = JSON.parse(rd('storyboard_input.json'));
    else {
      let problemText = rd('problem.txt'), sourceNote = '';
      if (inp.problemUrl) {
        stage('problem', '正在读取题目链接', .01);
        const page = await fetchPage(inp.problemUrl); fs.writeFileSync(path.join(dir, 'problem_fetched.txt'), page);
        problemText = (problemText ? problemText + '\n\n' : '') + '以下是题目网页的文字内容（可能夹杂导航等无关文字，请自行甄别）：\n' + page;
      }
      const image = has('problem_image.txt') ? rd('problem_image.txt') : null;
      stage('storyboard', `AI（${modelCfg.model}）正在设计分镜，通常需要 1~3 分钟`, .04);
      const req = { system: SBD.SYSTEM, image, user: SBD.buildUser({ problemText, hasImage: !!image, code, lang: inp.lang, age: inp.age, minutes: inp.minutes, characterName: JSON.parse(rd('character.json')).name, sourceNote }) };
      let text = await llm.chat(modelCfg, req); fs.writeFileSync(path.join(dir, 'llm_raw.txt'), text);
      try { raw = SBD.extractJson(text); } catch (e) {
        stage('storyboard', 'AI 返回的格式有误，正在让它重写一次', .1);
        text = await llm.chat(modelCfg, { ...req, user: req.user + `\n\n注意：上一次的输出无法解析（${e.message}）。请只输出一个完整、合法的 JSON 对象。` });
        fs.writeFileSync(path.join(dir, 'llm_raw.txt'), text); raw = SBD.extractJson(text);
      }
    }
    const nz = SBD.normalize(raw, { lang: inp.lang, codeLines });
    if (['night', 'day', 'ocean'].includes(inp.theme)) nz.sb.theme = inp.theme;
    fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(nz.sb, null, 1));
    upd({ title: nz.sb.title, algorithm: nz.sb.algorithm, warnings: nz.warnings, sentences: nz.sentences, chars: nz.chars });

    stage('voice', '正在生成配音', .15);
    const v = VOICES.find(x => x.id === inp.voiceId) || VOICES[0];
    const voiceCmd = USE_PY_VOICE ? PY : process.execPath;
    const voiceScript = path.join(ROOT, 'lib', USE_PY_VOICE ? 'voice.py' : 'voice.js');
    await run(voiceCmd, [voiceScript, dir, v.voice, v.fx ? '1' : '0', v.rate, v.pitch], l => {
      const m = /^TTS (\d+) (\d+)/.exec(l); if (m) upd({ progress: .15 + .15 * m[1] / m[2], stageLabel: `正在生成配音 ${m[1]}/${m[2]}` });
    });
    const tl = JSON.parse(rd('timeline.json')), frames = tl.frames, fdir = path.join(dir, 'frames');
    fs.rmSync(fdir, { recursive: true, force: true }); fs.mkdirSync(fdir);

    stage('render', '正在逐帧绘制动画', .3);
    const nw = Math.max(2, Math.min(6, os.cpus().length - 2)), chunk = Math.ceil(frames / nw), warns = new Set();
    const timer = setInterval(() => { try { const n = fs.readdirSync(fdir).length; upd({ progress: .3 + .62 * n / frames, stageLabel: `正在逐帧绘制动画 ${Math.round(100 * n / frames)}%` }); } catch (e) { /* ignore */ } }, 1500);
    try {
      await Promise.all(Array.from({ length: nw }, (_, i) => [i * chunk, Math.min(frames, (i + 1) * chunk)]).filter(([a, b]) => a < b)
        .map(([a, b]) => run(process.execPath, [path.join(ROOT, 'lib', 'render.js'), dir, '--from', String(a), '--to', String(b)], l => {
          const m = /^PLAYER_WARNINGS (.*)$/.exec(l); if (m) try { JSON.parse(m[1]).forEach(x => warns.add(x)); } catch (e) { /* ignore */ }
        })));
    } finally { clearInterval(timer); }
    const got = fs.readdirSync(fdir).length;
    if (got !== frames) throw new Error(`画面只渲染出 ${got}/${frames} 帧`);
    if (warns.size) upd({ warnings: [...job.warnings, ...[...warns].map(x => '画面：' + x)].slice(0, 16) });

    stage('mux', '正在合成视频', .93);
    await run(FFMPEG, ['-y', '-v', 'error', '-framerate', String(tl.fps), '-i', path.join(fdir, '%05d.jpg'), '-i', path.join(dir, 'narration.wav'),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
      '-movflags', '+faststart', '-shortest', path.join(dir, 'video.mp4')]);
    await run(FFMPEG, ['-y', '-v', 'error', '-ss', String(Math.min(6, frames / tl.fps / 2)), '-i', path.join(dir, 'video.mp4'), '-frames:v', '1', '-vf', 'scale=640:-1', path.join(dir, 'cover.jpg')]).catch(() => { });
    fs.rmSync(fdir, { recursive: true, force: true }); fs.rmSync(path.join(dir, 'audio'), { recursive: true, force: true });
    upd({ status: 'done', stage: 'done', stageLabel: '完成', progress: 1, duration: +(frames / tl.fps).toFixed(1), sizeBytes: fs.statSync(path.join(dir, 'video.mp4')).size, finishedAt: Date.now() });
  } catch (e) {
    upd({ status: 'failed', error: String(e.message || e).slice(0, 600), finishedAt: Date.now() });
    fs.rmSync(path.join(dir, 'frames'), { recursive: true, force: true });
  }
}

const sharing = new Set();                                  // job ids being uploaded right now
async function shareJob(id, opt) {
  const job = loadJob(id), file = path.join(jobDir(id), 'video.mp4');
  if (job.status !== 'done' || !fs.existsSync(file)) throw new Error('视频还没有生成完成');
  if (sharing.has(id)) throw new Error('这个视频正在上传，请稍等');
  sharing.add(id);
  try {
    const url = await require('./nos').upload(file, `oi-video-${id}.mp4`, { ...opt, type: 'video/mp4' });
    const j = loadJob(id); j.shareUrl = url; j.sharedAt = Date.now(); saveJob(j);
    return j;
  } finally { sharing.delete(id); }
}

module.exports = { shareJob, VOICES, listChars, addChar, removeChar, listJobs, loadJob, createJob, cancelJob, deleteJob, recoverOnStart, jobDir, DATA };
