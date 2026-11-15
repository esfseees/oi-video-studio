// Upload a finished file to Youdao NOS (internal upload service) and return its link.
// Same call the page https://nos.inner.youdao.com/ makes: POST /api/upload, multipart field "file".
const fs = require('fs');

const DEFAULT_ENDPOINT = 'https://nos.inner.youdao.com';

async function upload(file, name, { endpoint = DEFAULT_ENDPOINT, cdn = true, type = 'application/octet-stream', timeoutMs = 15 * 60 * 1000 } = {}) {
  const base = String(endpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
  const fd = new FormData();
  fd.append('file', await fs.openAsBlob(file, { type }), name);
  const url = `${base}/api/upload?needMin=false&isUploadNos=true&_=${Date.now()}_${Math.floor(Math.random() * 9999999999)}&isCDN=${cdn ? 'true' : 'false'}`;
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
  let res, text;
  try { res = await fetch(url, { method: 'POST', body: fd, signal: ac.signal }); text = await res.text(); }
  catch (e) { throw new Error(e.name === 'AbortError' ? '上传 NOS 超时' : `连不上 NOS 上传服务（${base}）：${e.cause ? e.cause.message : e.message}。这个服务只能在公司内网访问。`); }
  finally { clearTimeout(timer); }
  let j = null; try { j = JSON.parse(text); } catch (e) { /* not json */ }
  if (!res.ok || !j) throw new Error(`NOS 上传失败（${res.status}）：${text.slice(0, 200)}`);
  const link = j.success && j.data && j.data.nosRes && j.data.nosRes.data && j.data.nosRes.data.url;
  if (!link) throw new Error('NOS 上传失败：' + ((j.data && j.data.nosRes && j.data.nosRes.msg) || j.message || text.slice(0, 200)));
  return link;
}

module.exports = { upload, DEFAULT_ENDPOINT };
