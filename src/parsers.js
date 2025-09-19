// Pluggable parser registry and unified parse entrypoints
// Types supported:
// - 'zhipu_agent': Call Zhipu Agent API with per-node config
// - 'chatgpt_agent': 内置提示的 ChatGPT Agent 抽取（model+apiKey）
// - 'bailian_agent': 阿里百炼 Agent API (agentId + apiKey)
// - 'json_mapping': Map fields from JSON list using simple path selection
import { loadSettings, DEFAULTS, parseLLMTime, parseSJTUTime } from './shared.js';

// Small helper to include a clipped snippet in error messages without flooding the UI
function buildSnippet(label, text, maxLen = 500) {
  try {
    const s = String(text ?? '');
    const clipped = s.length > maxLen ? (s.slice(0, maxLen) + ` …(已截断, 共${s.length}字)`) : s;
    return `${label ? label + '：' : ''}${clipped}`;
  } catch {
    return '';
  }
}

// ---------------- Storage ----------------
export async function loadParsers() {
  const area = chrome?.storage?.local;
  const data = await area.get(['parsers']);
  const list = Array.isArray(data.parsers) ? data.parsers : [];
  // sanitize basic shape
  return list.map((p) => {
    let type = String(p.type || '').trim();
    if(type === 'openai_agent') type = 'chatgpt_agent'; // migrate legacy
  const allowed = ['json_mapping','zhipu_agent','chatgpt_agent','bailian_agent'];
    if(!allowed.includes(type)) type = 'zhipu_agent';
    return { id: p.id || ('parser-' + Math.random().toString(36).slice(2)), name: p.name || '未命名解析器', type, config: p.config || {} };
  });
}

export async function saveParsers(parsers) {
  const area = chrome?.storage?.local;
  const list = Array.isArray(parsers) ? parsers.map((p) => {
    let type = String(p.type || '').trim();
    if(type === 'openai_agent') type = 'chatgpt_agent';
  const allowed = ['json_mapping','zhipu_agent','chatgpt_agent','bailian_agent'];
    if(!allowed.includes(type)) type = 'zhipu_agent';
    return { id: p.id || ('parser-' + Math.random().toString(36).slice(2)), name: String(p.name || '未命名解析器'), type, config: typeof p.config === 'object' && p.config ? p.config : {} };
  }) : [];
  await area.set({ parsers: list });
  return list;
}

export async function getParserById(id) {
  if (!id) return null;
  const list = await loadParsers();
  return list.find((p) => p.id === id) || null;
}

// --------------- Unified Parse -----------------
export async function parseWithParser(rawText, parser, options = {}) {
  if (!parser || !parser.type) throw new Error('解析器无效');
  if (parser.type === 'zhipu_agent') return parseViaZhipuAgent(rawText, parser.config || {}, options);
  if (parser.type === 'chatgpt_agent') return parseViaChatGPTAgent(rawText, parser.config || {}, options);
  if (parser.type === 'bailian_agent') return parseViaBailianAgent(rawText, parser.config || {}, options);
  if (parser.type === 'json_mapping') return parseViaJsonMapping(rawText, parser.config || {}, options);
  throw new Error('未知解析器类型 ' + parser.type);
}

// --------------- Zhipu Agent ---------------
async function parseViaZhipuAgent(rawText, config, options) {
  const settings = await loadSettings();
  const apiUrl = (config.apiUrl || settings.llmApiUrl || DEFAULTS.llmApiUrl);
  const apiKey = (config.apiKey || settings.llmApiKey);
  const agentId = (config.agentId || settings.llmAgentId);
  if (!apiKey) throw new Error('未配置 API Key');
  if (!agentId) throw new Error('未配置 Agent ID');

  let inputText = String(rawText || '');
  // 如果调用方提供了 jsonPaths 并且文本本身是 JSON，可先裁剪
  const pathsStr = options.jsonPaths || config.jsonPaths;
  if (pathsStr) {
    const narrowed = narrowTextByJsonPaths(inputText, pathsStr);
    if (narrowed) inputText = narrowed;
  }

  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];
  const userPrompt = `今天的日期是 ${todayDate}，当前时间是 ${currentTime}。\n\n请从以下文本中提取日程 (以 JSON 返回，格式 {"events":[{"title":"","startTime":"YYYY-MM-DD HH:mm","endTime":"YYYY-MM-DD HH:mm","location":""}]}, 不要包含其他文字)：\n`;
  const body = {
    app_id: agentId,
    messages: [
      { role: 'user', content: [ { type: 'input', value: userPrompt + inputText.slice(0, 4000) } ] },
    ],
    stream: false,
  };
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('LLM 请求失败 ' + resp.status);
  const json = await resp.json();
  const content = json.choices?.[0]?.messages?.content?.msg;
  if (!content) throw new Error('LLM 返回空内容');
  let parsed;
  try { parsed = JSON.parse(content); } catch {
    // Include a clipped snippet of the LLM output to help diagnose parse issues
    throw new Error('解析 LLM JSON 失败。' + buildSnippet('LLM 输出片段', content));
  }
  if (!Array.isArray(parsed.events)) throw new Error('事件结构无效');
  const events = parsed.events.map((ev) => ({
    ...ev,
    startTime: parseLLMTime(ev.startTime),
    endTime: parseLLMTime(ev.endTime),
  })).filter((ev) => ev.title && ev.startTime && ev.endTime);
  return events;
}

// --------------- ChatGPT Agent (Built-in Prompt) ---------------
// Uses provided specialized extraction prompt. Config: { apiKey, model, apiUrl? }
// If apiUrl omitted, defaults to OpenAI chat completions endpoint.
async function parseViaChatGPTAgent(rawText, config, options){
  const settings = await loadSettings();
  const apiUrl = (config.apiUrl || settings.openaiApiUrl || 'https://api.openai.com/v1/chat/completions');
  const apiKey = (config.apiKey || settings.openaiApiKey);
  const model = (config.model || settings.openaiModel || 'gpt-5');
  if(!apiKey) throw new Error('未配置 API Key');
  if(!model) throw new Error('未配置模型');

  let inputText = String(rawText||'');
  const pathsStr = options.jsonPaths || config.jsonPaths;
  if(pathsStr){
    const narrowed = narrowTextByJsonPaths(inputText, pathsStr);
    if(narrowed) inputText = narrowed;
  }

  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];

  const builtPrompt = `你是一个能够提取和格式化日程信息的助手。你的任务是从一段可能包含大量杂乱信息的非结构化文本中，准确识别出有效的日程事件，并将其转换为符合 iCalendar 标准的 JSON 格式（不是 .ics 文件，而是其结构化 JSON 表达，方便程序进一步生成 .ics 上传到 radical 日历服务器）。\n\n【输入可能包含】：\n- 事件名称、日期、开始时间、结束时间、时区\n- 事件描述\n- 事件地点\n- 可能还有与日程无关的杂乱信息（如广告、签名、重复内容）\n- 有时日期或时间会用自然语言描述（例如“明天下午3点”）\n\n【解析要求】：\n1. 从输入文本中提取所有有用的日程信息，忽略无关内容。\n2. 处理时间时，优先解析为 YYYYMMDDTHHMMSSZ 或带时区的 ISO 格式（例如 20250812T090000+0800）。\n3. 对于跨越多天的事件，需要将事件拆分为开始和结束时间点。\n4. 如果某些信息缺失（例如结束时间），保持字段为空字符串或 null。\n5. 如果无法解析出任何有效的日程，返回空的事件列表。\n6. 支持识别相对时间（如“明天”“下周一”），并转为绝对时间（需使用当前日期上下文）。\n7. 注意Title的完整性，比如文本前文出现项目名称需补全。\n\n【输出 JSON 格式要求】：\n顶层对象，包含 events 数组：每个事件包含 title,startTime,endTime,location,description。\n\n【输出要求】：\n- 只输出 JSON，不要包含额外文字或解释。\n- 确保可被 JSON.parse 解析。\n- 多事件按时间顺序排序。\n- 可缺失的字段使用空字符串或 null。\n  下面是需要解析生成JSON的内容，当前日期：${todayDate} 当前时间：${currentTime}。事件包含为下面的信息中：\n`;
  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role:'system', content: '专注日程抽取。严格仅输出 {"events":[...]} JSON。' },
      { role:'user', content: builtPrompt + inputText.slice(0, 8000) }
    ],
    response_format: { type: 'json_object' }
  };

  const resp = await fetch(apiUrl, {
    method:'POST',
    headers:{ 'Authorization':'Bearer '+apiKey, 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  if(!resp.ok) throw new Error('ChatGPT Agent 请求失败 '+ resp.status);
  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content;
  if(!content) throw new Error('返回空内容');
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('解析 JSON 失败。'+ buildSnippet('输出片段', content)); }
  if(!Array.isArray(parsed.events)) throw new Error('事件结构无效');
  const events = parsed.events.map(ev => ({
    ...ev,
    startTime: parseLLMTime(ev.startTime) || parseLLMTime(ev.start_time) || ev.startTime,
    endTime: parseLLMTime(ev.endTime) || parseLLMTime(ev.end_time) || ev.endTime,
    description: ev.description
  })).filter(ev => ev.title && ev.startTime && ev.endTime);
  return events;
}

// --------------- Bailian Agent (Apps Completion API) ---------------
// Config: { apiKey, agentId(app_id)?, apiUrl? }
// Default agentId = '1ca80897bf214db08d43654aa2264f3d'
// Endpoint: POST https://dashscope.aliyuncs.com/api/v1/apps/{app_id}/completion
async function parseViaBailianAgent(rawText, config, options){
  const settings = await loadSettings();
  const apiKey = (config.apiKey || settings.bailianApiKey);
  const appId = (config.agentId || settings.bailianAgentId || '1ca80897bf214db08d43654aa2264f3d');
  const apiBase = (config.apiUrl || settings.bailianApiUrl || 'https://dashscope.aliyuncs.com/api/v1/apps');
  if(!apiKey) throw new Error('未配置百炼 API Key');
  if(!appId) throw new Error('未配置百炼 App ID');

  let inputText = String(rawText||'');
  const pathsStr = options.jsonPaths || config.jsonPaths;
  if(pathsStr){
    const narrowed = narrowTextByJsonPaths(inputText, pathsStr);
    if(narrowed) inputText = narrowed;
  }

  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];
  const userPrompt = `今天日期 ${todayDate} 当前时间 ${currentTime}，请从以下文本中提取日程事件，仅输出 JSON: {"events":[{"title":"","startTime":"YYYY-MM-DD HH:mm","endTime":"YYYY-MM-DD HH:mm","location":"","description":""}]}. 文本：\n`;

  // Bailian apps completion commonly uses messages-based input
  const body = {
    input: {
      messages: [
        { role: 'user', content: userPrompt + inputText.slice(0, 6000) }
      ]
    }
  };

  const endpoint = `${apiBase.replace(/\/$/,'')}/${encodeURIComponent(appId)}/completion`;
  const resp = await fetch(endpoint, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+ apiKey },
    body: JSON.stringify(body)
  });
  if(!resp.ok) throw new Error('Bailian 请求失败 '+resp.status);
  const json = await resp.json();
  // The content may appear as output.text or choices-like structure depending on app
  const content = json.output?.text || json.output || json.result || json.data || '';
  if(!content || typeof content !== 'string') throw new Error('Bailian 返回空内容');
  let matched = content.trim();
  matched = matched.replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const braceIdx = matched.indexOf('{');
  if(braceIdx > 0) matched = matched.slice(braceIdx);
  let parsed;
  try { parsed = JSON.parse(matched); } catch {
    throw new Error('解析 Bailian JSON 失败。'+ buildSnippet('输出片段', matched));
  }
  if(!Array.isArray(parsed.events)) throw new Error('事件结构无效');
  const events = parsed.events.map(ev => ({
    ...ev,
    startTime: parseLLMTime(ev.startTime) || parseLLMTime(ev.start_time) || ev.startTime,
    endTime: parseLLMTime(ev.endTime) || parseLLMTime(ev.end_time) || ev.endTime,
    description: ev.description
  })).filter(ev => ev.title && ev.startTime && ev.endTime);
  return events;
}

// --------------- JSON Mapping ---------------
function splitJsonPathSegments(path) {
  const s = String(path || '');
  const segs = [];
  let cur = '';
  let inBracket = false, inQuote = false, quoteChar = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inBracket && ch === '.') { segs.push(cur); cur = ''; continue; }
    if (ch === '[') { inBracket = true; }
    if (inBracket && (ch === '"' || ch === '\'')) {
      if (!inQuote) { inQuote = true; quoteChar = ch; }
      else if (quoteChar === ch) { inQuote = false; quoteChar = ''; }
    }
    if (ch === ']' && !inQuote) { inBracket = false; }
    cur += ch;
  }
  if (cur) segs.push(cur);
  return segs.map(t => t.trim()).filter(Boolean);
}

function tokenizeJsonPath(path) {
  const parts = [];
  const segs = splitJsonPathSegments(path);
  for (const seg of segs) {
    let rest = seg;
    // bracket-quoted full key e.g. ["foo-bar"] or ['中文'] possibly followed by indices
    const mQuoted = rest.match(/^\[("([\s\S]*?)"|'([\s\S]*?)')\](.*)$/);
    if (mQuoted) {
      const key = (mQuoted[2] ?? mQuoted[3]) || '';
      parts.push({ type: 'key', key });
      rest = mQuoted[4] || '';
    } else {
      // bare key: allow unicode and hyphens until bracket start
      const mKey = rest.match(/^([^\[]+)(.*)$/);
      if (mKey) { parts.push({ type: 'key', key: mKey[1] }); rest = mKey[2]; }
    }
    while (rest && rest.length) {
      const mIndex = rest.match(/^\[(\d+)\](.*)$/);
      if (mIndex) { parts.push({ type: 'index', index: Number(mIndex[1]) }); rest = mIndex[2]; continue; }
      const mAll = rest.match(/^\[\*\](.*)$/);
      if (mAll) { parts.push({ type: 'wildcard' }); rest = mAll[1]; continue; }
      const mKeyQuoted = rest.match(/^\[("([\s\S]*?)"|'([\s\S]*?)')\](.*)$/);
      if (mKeyQuoted) { parts.push({ type:'key', key: (mKeyQuoted[2] ?? mKeyQuoted[3])||'' }); rest = mKeyQuoted[4]||''; continue; }
      break;
    }
    // segments that were standalone [index] or [*]
    if (/^\[(\d+)\]$/.test(seg)) parts.push({ type: 'index', index: Number(RegExp.$1) });
    else if (seg === '[*]') parts.push({ type: 'wildcard' });
  }
  return parts;
}

function evaluateSinglePath(root, pathSpec) {
  const tokens = tokenizeJsonPath(pathSpec);
  let current = [root];
  for (const tk of tokens) {
    const next = [];
    for (const node of current) {
      if (tk.type === 'key') {
        if (node && Object.prototype.hasOwnProperty.call(node, tk.key)) next.push(node[tk.key]);
      } else if (tk.type === 'index') {
        if (Array.isArray(node) && node.length > tk.index) next.push(node[tk.index]);
      } else if (tk.type === 'wildcard') {
        if (Array.isArray(node)) next.push(...node);
      }
    }
    current = next;
    if (!current.length) break;
  }
  return current;
}

function narrowTextByJsonPaths(rawText, pathsStr) {
  if (!rawText || !pathsStr) return null;
  const trimmed = String(rawText).trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  let obj; try { obj = JSON.parse(trimmed); } catch { return null; }
  const rawPaths = String(pathsStr).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!rawPaths.length) return null;
  const collected = [];
  for (const p of rawPaths) {
    let vals; try { vals = evaluateSinglePath(obj, p); } catch { vals = []; }
    if (!vals || !vals.length) continue;
    const explicitArrayMatch = /(\[(?:\d+|\*)\])\s*$/.test(p);
    for (const v of vals) {
      if (Array.isArray(v)) {
        if (explicitArrayMatch) { for (const item of v) { collected.push(item); if (collected.length >= 200) break; } }
        else { collected.push(v); }
      } else { collected.push(v); }
      if (collected.length >= 200) break;
    }
    if (collected.length >= 200) break;
  }
  if (!collected.length) return null;
  const snippet = JSON.stringify(collected.slice(0, 200), null, 2);
  return snippet.length > 18000 ? snippet.slice(0, 18000) : snippet;
}

function getFirst(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

async function parseViaJsonMapping(rawText, config, options = {}) {
  let data;
  try { data = JSON.parse(String(rawText || '').trim()); } catch {
    // On JSON parse errors, include a clipped rawText snippet for easier debugging
    throw new Error('输入不是合法 JSON。' + buildSnippet('原文片段', rawText));
  }
  // Locate list
  let items = [];
  if (Array.isArray(data)) items = data;
  else if (data && typeof data === 'object') {
    // 若 options.jsonPaths 提供了列表路径，从 options 控制（来自任务的数据获取阶段）
    const listPaths = String(options.jsonPaths || '').split(/\n+/).map(s=>s.trim()).filter(Boolean);
    if(listPaths.length){
      const collected = [];
      for(const p of listPaths){
        let vals = [];
        try { vals = evaluateSinglePath(data, p); } catch { vals = []; }
        for(const v of vals){ if(Array.isArray(v)) collected.push(...v); else if(v && typeof v==='object') collected.push(v); }
      }
      items = collected;
    } else {
      // 否则退回启发式：找到第一个对象数组
      for (const k of Object.keys(data)) { if (Array.isArray(data[k])) { items = data[k]; break; } }
    }
  }
  if (!Array.isArray(items)) throw new Error('未找到可迭代的事件列表');

  const listOrDefault = (val, def) => {
    const arr = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',') : []);
    const clean = arr.map((s) => String(s).trim()).filter(Boolean);
    return clean.length ? clean : def;
  };
  const fm = config.fieldMap || { title: ['title','summary','name'], startTime: ['startTime','begin','start'], endTime: ['endTime','finish','end'], location: ['location','place'] };
  const defs = config.defaults || {};
  const fmTitle = listOrDefault(fm.title, ['title','summary','name']);
  const fmStart = listOrDefault(fm.startTime, ['startTime','begin','start']);
  const fmEnd = listOrDefault(fm.endTime, ['endTime','finish','end']);
  const fmLoc = listOrDefault(fm.location, ['location','place']);
  const fmUid = listOrDefault(fm.uid, ['uid','id','eventId']);
  const fmDesc = listOrDefault(fm.description, ['description','desc','detail']);

  function pickOrDefault(obj, keys, defVal){
    const v = getFirst(obj, keys);
    return (v == null || v === '') ? defVal : v;
  }

  function genUid(){ return 'evt-' + Math.random().toString(36).slice(2, 10); }

  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const titleRaw = pickOrDefault(it, fmTitle, defs.title);
    const sRaw = pickOrDefault(it, fmStart, defs.startTime);
    const eRaw = pickOrDefault(it, fmEnd, defs.endTime);
    const locRaw = pickOrDefault(it, fmLoc, defs.location);
    const uidRaw = pickOrDefault(it, fmUid, defs.uid);
    const descRaw = pickOrDefault(it, fmDesc, defs.description);

    const s2 = parseSJTUTime(sRaw) || parseLLMTime(sRaw) || sRaw;
    const e2 = parseSJTUTime(eRaw) || parseLLMTime(eRaw) || eRaw;
    const title = titleRaw ? String(titleRaw) : '';
    const location = locRaw ? String(locRaw) : '';
    let uid = uidRaw ? String(uidRaw) : '';
    if(!uid || uid.toLowerCase() === 'auto') uid = genUid();
    const description = (descRaw == null || descRaw === '') ? undefined : String(descRaw);

    if (!title || !s2 || !e2) continue;
    out.push({ id: uid, title, startTime: s2, endTime: e2, location, description, raw: it });
  }
  return out;
}
