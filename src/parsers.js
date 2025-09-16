// Pluggable parser registry and unified parse entrypoints
// Types supported:
// - 'zhipu_agent': Call Zhipu Agent API with per-node config
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
  return list.map((p) => ({
    id: p.id || ('parser-' + Math.random().toString(36).slice(2)),
    name: p.name || '未命名解析器',
    type: p.type === 'json_mapping' ? 'json_mapping' : 'zhipu_agent',
    config: p.config || {},
  }));
}

export async function saveParsers(parsers) {
  const area = chrome?.storage?.local;
  const list = Array.isArray(parsers) ? parsers.map((p) => ({
    id: p.id || ('parser-' + Math.random().toString(36).slice(2)),
    name: String(p.name || '未命名解析器'),
    type: p.type === 'json_mapping' ? 'json_mapping' : 'zhipu_agent',
    config: typeof p.config === 'object' && p.config ? p.config : {},
  })) : [];
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
