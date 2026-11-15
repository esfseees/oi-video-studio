// AI model access: provider presets + one chat call (text, optional image) + model listing.
const PROVIDERS = [
  { id: 'openai', name: 'OpenAI（GPT）', api: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'], vision: true },
  { id: 'anthropic', name: 'Anthropic（Claude）', api: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'], vision: true },
  { id: 'gemini', name: 'Google Gemini', api: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], vision: true },
  { id: 'deepseek', name: 'DeepSeek', api: 'openai', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], vision: false },
  { id: 'qwen', name: '通义千问（阿里云百炼）', api: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-vl-max'], vision: true },
  { id: 'zhipu', name: '智谱 GLM', api: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4v-plus', 'glm-4-flash'], vision: true },
  { id: 'moonshot', name: 'Kimi（Moonshot）', api: 'openai', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-32k', 'moonshot-v1-32k-vision-preview'], vision: true },
  { id: 'doubao', name: '豆包（火山方舟）', api: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: [], vision: true, hint: '模型名填方舟控制台里的模型 ID 或接入点 ID' },
  { id: 'siliconflow', name: '硅基流动 SiliconFlow', api: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'], vision: false },
  { id: 'ollama', name: 'Ollama（本机模型）', api: 'openai', baseUrl: 'http://localhost:11434/v1', models: [], noKey: true, vision: false, hint: '需要本机已安装并运行 Ollama' },
  { id: 'custom', name: '自定义（OpenAI 兼容接口）', api: 'openai', baseUrl: '', models: [], vision: true, hint: '填写任意兼容 /chat/completions 的服务地址' },
];

const trimBase = u => String(u || '').trim().replace(/\/+$/, '');
const provider = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[PROVIDERS.length - 1];

async function http(url, opt, timeoutMs) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
  let res, text;
  try { res = await fetch(url, { ...opt, signal: ac.signal }); text = await res.text(); }
  catch (e) { throw new Error(e.name === 'AbortError' ? `模型接口超时（${Math.round(timeoutMs / 1000)} 秒没有返回）` : `连不上模型接口 ${url}：${e.cause ? e.cause.message : e.message}`); }
  finally { clearTimeout(timer); }
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  if (!res.ok) {
    const msg = json && (json.error && (json.error.message || json.error) || json.message) || text.slice(0, 300);
    throw new Error(`模型接口返回错误 ${res.status}：${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  if (!json) throw new Error('模型接口返回的不是 JSON：' + text.slice(0, 200));
  return json;
}

// cfg: { provider, baseUrl, model, apiKey }; image: data URL or null
async function chat(cfg, { system, user, image, timeoutMs = 600000 }) {
  const p = provider(cfg.provider), base = trimBase(cfg.baseUrl || p.baseUrl);
  if (!base) throw new Error('还没有填写模型接口地址');
  if (!cfg.model) throw new Error('还没有填写模型名称');
  if (!cfg.apiKey && !p.noKey) throw new Error('还没有填写 API Key');
  if (p.api === 'anthropic') {
    const content = [];
    if (image) { const m = /^data:([^;]+);base64,(.*)$/s.exec(image); if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }); }
    content.push({ type: 'text', text: user });
    const call = max => http(base + '/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.model, max_tokens: max, system, messages: [{ role: 'user', content }] }),
    }, timeoutMs);
    let j; try { j = await call(16000); } catch (e) { if (/max_tokens/.test(e.message)) j = await call(8192); else throw e; }
    const out = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    if (!out) throw new Error('模型没有返回内容');
    return out;
  }
  const content = image ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: image } }] : user;
  const headers = { 'content-type': 'application/json' }; if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
  const j = await http(base + '/chat/completions', {
    method: 'POST', headers, body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
  }, timeoutMs);
  const msg = j.choices && j.choices[0] && j.choices[0].message;
  const out = msg && (typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(c => c.text || '').join('') : '');
  if (!out) throw new Error('模型没有返回内容');
  return out;
}

async function listModels(cfg) {
  const p = provider(cfg.provider), base = trimBase(cfg.baseUrl || p.baseUrl);
  if (!base) throw new Error('还没有填写模型接口地址');
  const headers = p.api === 'anthropic' ? { 'x-api-key': cfg.apiKey || '', 'anthropic-version': '2023-06-01' } : (cfg.apiKey ? { authorization: 'Bearer ' + cfg.apiKey } : {});
  const j = await http(base + (p.api === 'anthropic' ? '/v1/models' : '/models'), { headers }, 20000);
  const list = (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean);
  if (!list.length) throw new Error('接口没有返回模型列表，请手动填写模型名称');
  return list.sort();
}

module.exports = { PROVIDERS, provider, chat, listModels };
