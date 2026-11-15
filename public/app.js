// 信奥讲解视频工坊 — page logic (no framework)
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let ST = null, curId = null, pollT = null, imgData = null, selChar = 'xiaotuling', curDetail = null;

async function api(url, method, body) {
  const r = await fetch(url, { method: method || 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
  if (r.status === 401 && j.needLogin) { location.reload(); throw new Error(j.error); }
  if (!r.ok || j.error) throw new Error(j.error || '请求失败（' + r.status + '）');
  return j;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDur = s => s ? Math.floor(s / 60) + ' 分 ' + String(Math.round(s % 60)).padStart(2, '0') + ' 秒' : '';
const fmtSize = b => b ? (b / 1048576).toFixed(1) + ' MB' : '';
const fmtDate = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
function msg(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }

// ---------- initial state ----------
async function load() {
  ST = await api('/api/state');
  $('#voice').innerHTML = ST.voices.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  $('#age').innerHTML = Array.from({ length: 11 }, (_, i) => i + 8).map(a => `<option value="${a}"${a === 12 ? ' selected' : ''}>${a} 周岁</option>`).join('');
  renderChars(); renderChip(); renderHistory(ST.jobs);
  const running = ST.jobs.find(j => j.status === 'running' || j.status === 'queued');
  if (running) watch(running.id);
}
function renderChip() {
  const c = ST.config, p = ST.providers.find(x => x.id === c.active), s = c.providers[c.active] || {}, ok = !!s.model && (s.hasKey || p.noKey);
  $('#modelChip').textContent = ok ? `${p.name} · ${s.model}` : '还没有配置 AI 模型，点这里设置';
  $('#modelDot').className = 'dot' + (ok ? ' ok' : '');
}

// ---------- problem input ----------
$$('.tab').forEach(b => b.onclick = () => { $$('.tab').forEach(x => x.classList.toggle('on', x === b)); $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + b.dataset.tab)); });
function markTabs() {
  const has = { text: $('#problemText').value.trim(), image: imgData, url: $('#problemUrl').value.trim() };
  $$('.tab').forEach(b => b.classList.toggle('has', !!has[b.dataset.tab]));
}
$('#problemText').oninput = $('#problemUrl').oninput = markTabs;
function setImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {                                       // shrink big screenshots before sending to the model
    const k = Math.min(1, 2200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    imgData = c.toDataURL('image/jpeg', .92); URL.revokeObjectURL(url);
    $('#imgPreview').src = imgData; $('#drop').classList.add('has'); $('#imgClear').hidden = false; markTabs();
  };
  img.src = url;
}
$('#drop').onclick = () => $('#imgInput').click();
$('#imgInput').onchange = e => setImage(e.target.files[0]);
$('#drop').ondragover = e => { e.preventDefault(); $('#drop').classList.add('over'); };
$('#drop').ondragleave = () => $('#drop').classList.remove('over');
$('#drop').ondrop = e => { e.preventDefault(); $('#drop').classList.remove('over'); setImage(e.dataTransfer.files[0]); };
$('#imgClear').onclick = () => { imgData = null; $('#drop').classList.remove('has'); $('#imgClear').hidden = true; $('#imgInput').value = ''; markTabs(); };
document.addEventListener('paste', e => {
  const f = [...(e.clipboardData || {}).files || []].find(x => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); setImage(f); $$('.tab').find(b => b.dataset.tab === 'image').click(); }
});
$('#code').addEventListener('keydown', e => {                 // Tab inserts spaces instead of leaving the box
  if (e.key !== 'Tab') return; e.preventDefault();
  const t = e.target, a = t.selectionStart; t.setRangeText('    ', a, t.selectionEnd, 'end');
});

// ---------- characters ----------
function renderChars() {
  if (!ST.characters.some(c => c.id === selChar)) selChar = ST.characters[0].id;
  $('#chars').innerHTML = ST.characters.map(c => `<div class="char${c.id === selChar ? ' on' : ''}" data-id="${c.id}"><img src="${c.url}" alt=""><span>${esc(c.name)}</span>${c.builtin ? '' : '<button class="x" title="删除这个角色">×</button>'}</div>`).join('')
    + '<div class="char add" id="charAdd"><div><i>＋</i>上传角色图片</div></div>';
  $$('#chars .char[data-id]').forEach(el => {
    el.onclick = () => { selChar = el.dataset.id; renderChars(); };
    const x = el.querySelector('.x');
    if (x) x.onclick = async ev => {
      ev.stopPropagation(); if (!confirm('删除这个角色？已生成的视频不受影响。')) return;
      try { await api('/api/characters/' + el.dataset.id, 'DELETE'); ST.characters = ST.characters.filter(c => c.id !== el.dataset.id); renderChars(); } catch (e) { alert(e.message); }
    };
  });
  $('#charAdd').onclick = () => $('#charFile').click();
}
$('#charFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const name = prompt('给这个角色起个名字（开场白会用到）', f.name.replace(/\.[^.]+$/, '').slice(0, 12)); if (name === null) { e.target.value = ''; return; }
  const rd = new FileReader();
  rd.onload = async () => {
    try { const r = await api('/api/characters', 'POST', { name: name.trim() || '我的角色', dataUrl: rd.result }); ST.characters.push(r.character); selChar = r.character.id; renderChars(); }
    catch (err) { alert(err.message); }
    e.target.value = '';
  };
  rd.readAsDataURL(f);
};

// ---------- create job ----------
const formBody = () => ({ problemText: $('#problemText').value, problemImage: imgData, problemUrl: $('#problemUrl').value.trim(), code: $('#code').value, lang: $('#lang').value,
  characterId: selChar, voiceId: $('#voice').value, age: $('#age').value, minutes: $('#minutes').value, theme: $('#theme').value });
async function submit(body) {
  msg($('#formMsg'), '');
  $('#btnGen').disabled = $('#btnDemo').disabled = true;
  try { const r = await api('/api/jobs', 'POST', body); watch(r.job.id); $('#jobPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (e) { msg($('#formMsg'), e.message, 'bad'); $('#btnGen').disabled = $('#btnDemo').disabled = false; if (/配置 AI 模型/.test(e.message)) openSettings(); }
}
$('#btnGen').onclick = () => submit(formBody());
$('#btnDemo').onclick = () => {
  $('#problemText').value = ST.demo.problem; $('#code').value = ST.demo.code; $('#lang').value = 'cpp'; markTabs();
  submit({ demo: true, characterId: selChar, voiceId: $('#voice').value, theme: $('#theme').value });
};
$('#btnRerender').onclick = () => {
  if (!curDetail) return;
  const inp = curDetail.job.input;
  submit({ storyboard: $('#sbEdit').value, code: curDetail.code, lang: inp.lang, characterId: selChar, voiceId: $('#voice').value, theme: $('#theme').value, age: inp.age, minutes: inp.minutes });
};

// ---------- job progress / result ----------
function watch(id) { curId = id; clearTimeout(pollT); $('#jobPanel').hidden = false; $('#result').hidden = true; $('#jobErr').hidden = true; $('#player').removeAttribute('src'); poll(); }
async function poll() {
  let j; try { j = (await api('/api/jobs/' + curId)).job; } catch (e) { return; }
  showJob(j);
  if (j.status === 'queued' || j.status === 'running') pollT = setTimeout(poll, 1500);
  else { $('#btnGen').disabled = $('#btnDemo').disabled = false; renderHistory((await api('/api/jobs')).jobs); }
}
async function showJob(j) {
  const busy = j.status === 'queued' || j.status === 'running';
  $('#jobTitle').textContent = j.status === 'done' ? `《${j.title}》讲解视频` : j.status === 'failed' ? '生成失败' : `正在生成${j.title && j.title !== '新讲解视频' ? '《' + j.title + '》' : ''}`;
  $('#btnCancel').hidden = !busy; $('#progressBox').hidden = !busy;
  $('#bar').style.width = Math.round((j.progress || 0) * 100) + '%';
  $('#jobStage').textContent = j.stageLabel || '';
  $('#jobErr').hidden = j.status !== 'failed'; $('#jobErr').textContent = j.error || '';
  $('#warns').innerHTML = (j.warnings || []).map(w => `<li>${esc(w)}</li>`).join('');
  if (j.status === 'done' && $('#result').hidden) {
    $('#result').hidden = false;
    const base = '/media/' + j.id + '/';
    $('#player').src = base + 'video.mp4'; $('#player').poster = base + 'cover.jpg';
    $('#dlVideo').href = base + 'video.mp4?dl=1'; $('#dlSrt').href = base + 'subtitles.srt?dl=1'; $('#dlSb').href = base + 'storyboard.json?dl=1';
    $('#meta').textContent = [fmtDur(j.duration), fmtSize(j.sizeBytes), j.sentences ? j.sentences + ' 句旁白' : '', j.model ? j.model.model : (j.input.source === 'demo' ? '内置示例' : '自带分镜')].filter(Boolean).join(' · ');
    showShare(j); msg($('#shareMsg'), '');
    try { curDetail = await api('/api/jobs/' + j.id + '/detail'); $('#sbEdit').value = curDetail.storyboard; } catch (e) { curDetail = null; }
  }
}
function showShare(j) {
  $('#shareBox').hidden = !j.shareUrl; $('#shareUrl').value = j.shareUrl || ''; $('#shareOpen').href = j.shareUrl || '#';
  $('#btnShare').textContent = j.shareUrl ? '重新上传到 NOS' : '上传到 NOS 获取分享链接'; $('#btnShare').disabled = false;
}
$('#btnShare').onclick = async () => {
  if (!curId) return;
  if (!confirm('把这个视频上传到有道 NOS？\n\n上传后会生成一个链接，拿到链接的人都能观看；文件会一直保留，这个网站里无法删除。')) return;
  $('#btnShare').disabled = true; msg($('#shareMsg'), '正在上传，视频较大时需要一两分钟…');
  try { const r = await api('/api/jobs/' + curId + '/share', 'POST', {}); showShare(r.job); msg($('#shareMsg'), '上传成功', 'good'); renderHistory((await api('/api/jobs')).jobs); }
  catch (e) { msg($('#shareMsg'), e.message, 'bad'); $('#btnShare').disabled = false; }
};
$('#btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#shareUrl').value); } catch (e) { $('#shareUrl').select(); document.execCommand('copy'); }
  msg($('#shareMsg'), '链接已复制', 'good');
};
$('#btnCancel').onclick = async () => { if (curId && confirm('取消这次生成？')) await api('/api/jobs/' + curId + '/cancel', 'POST', {}).catch(() => { }); };

function renderHistory(jobs) {
  const done = jobs.filter(j => j.status === 'done');
  $('#history').innerHTML = done.length ? done.map(j => `<div class="item" data-id="${j.id}"><div class="cover" style="background-image:url(/media/${j.id}/cover.jpg)"></div>${j.shareUrl ? '<span class="tag">已上传 NOS</span>' : ''}
    <div class="info"><div class="t">${esc(j.title)}</div><div class="d">${fmtDur(j.duration)} · ${fmtDate(j.createdAt)}</div></div><button class="del">删除</button></div>`).join('')
    : '<p class="empty">还没有视频。生成完成后会出现在这里，可以随时回来观看和下载。</p>';
  $$('#history .item').forEach(el => {
    el.onclick = () => { watch(el.dataset.id); $('#jobPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    el.querySelector('.del').onclick = async ev => {
      ev.stopPropagation(); if (!confirm('删除这个视频？删除后无法恢复。')) return;
      try { await api('/api/jobs/' + el.dataset.id, 'DELETE'); if (curId === el.dataset.id) { $('#jobPanel').hidden = true; $('#player').removeAttribute('src'); } renderHistory((await api('/api/jobs')).jobs); } catch (e) { alert(e.message); }
    };
  });
}

// ---------- model settings ----------
function fillProvider(id) {
  const p = ST.providers.find(x => x.id === id), s = ST.config.providers[id] || {};
  $('#sBase').value = s.baseUrl || p.baseUrl; $('#sModel').value = s.model || p.models[0] || '';
  $('#modelList').innerHTML = p.models.map(m => `<option value="${esc(m)}">`).join('');
  $('#sKey').value = ''; $('#sKey').placeholder = s.hasKey ? `已保存（尾号 ${s.keyTail}），留空则继续使用` : (p.noKey ? '本机模型不需要' : '粘贴 API Key');
  $('#sKeyRow').hidden = !!p.noKey; $('#sHint').textContent = (p.hint || '') + (p.vision === false ? (p.hint ? '；' : '') + '这个服务的模型一般不支持识图，题目请用文字或链接' : ''); $('#sHint').hidden = !$('#sHint').textContent;
  msg($('#sMsg'), '');
}
function openSettings() {
  $('#sProvider').innerHTML = ST.providers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('#sProvider').value = ST.config.active; fillProvider(ST.config.active); $('#settings').hidden = false;
}
const sBody = () => ({ provider: $('#sProvider').value, baseUrl: $('#sBase').value.trim(), model: $('#sModel').value.trim(), apiKey: $('#sKey').value.trim() });
$('#openSettings').onclick = openSettings;
$('#sProvider').onchange = e => fillProvider(e.target.value);
$('#sClose').onclick = () => { $('#settings').hidden = true; };
$('#settings').onclick = e => { if (e.target.id === 'settings') $('#settings').hidden = true; };
$('#sFetch').onclick = async () => {
  msg($('#sMsg'), '正在获取模型列表…');
  try { const r = await api('/api/models', 'POST', sBody()); $('#modelList').innerHTML = r.models.map(m => `<option value="${esc(m)}">`).join(''); msg($('#sMsg'), `获取到 ${r.models.length} 个模型，点模型名称输入框即可选择`, 'good'); $('#sModel').focus(); }
  catch (e) { msg($('#sMsg'), e.message, 'bad'); }
};
$('#sTest').onclick = async () => {
  msg($('#sMsg'), '正在测试…');
  try { const r = await api('/api/test', 'POST', sBody()); msg($('#sMsg'), `连接正常（${r.model}，${(r.ms / 1000).toFixed(1)} 秒），模型回复：${r.reply}`, 'good'); }
  catch (e) { msg($('#sMsg'), e.message, 'bad'); }
};
$('#sSave').onclick = async () => {
  try { const r = await api('/api/config', 'POST', sBody()); ST.config = r.config; renderChip(); $('#settings').hidden = true; msg($('#formMsg'), '模型配置已保存', 'good'); }
  catch (e) { msg($('#sMsg'), e.message, 'bad'); }
};

load().catch(e => msg($('#formMsg'), '页面加载失败：' + e.message, 'bad'));
