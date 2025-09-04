import {
  loadSettings,
  saveSettings,
  formatDateForAPI,
  isoToICSTime,
  parseSJTUTime,
  escapeICSText,
  DEFAULTS,
  parseLLMTime,
} from './shared.js';

// ------------------------------------------------------
// Basic HTTP wrapper (keeps credentials for SJTU calendar)
// ------------------------------------------------------
async function httpFetch(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, url: res.url };
}

// Fetch user profile (to get account id)
async function getProfile() {
  const r = await httpFetch('https://calendar.sjtu.edu.cn/api/share/profile');
  if (!r.ok) throw new Error('profile status ' + r.status);
  return JSON.parse(r.text);
}

// Fetch events in a date window
async function getEventsWindow(days = 14) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - days);
  const end = new Date(now);
  end.setDate(now.getDate() + days);
  const url = `https://calendar.sjtu.edu.cn/api/event/list?startDate=${formatDateForAPI(start)}&endDate=${formatDateForAPI(end)}&weekly=false&ids=`;
  const r = await httpFetch(url);
  if (!r.ok) throw new Error('events status ' + r.status);
  return JSON.parse(r.text);
}

// Build ICS text from event objects
function buildICS(events, calendarName = 'SJTU') {
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SJTU-Radicale-Sync//EN',
    `X-WR-CALNAME:${escapeICSText(calendarName)}`,
    'X-WR-TIMEZONE:UTC',
  ];
  for (const ev of events) {
    try {
      if (!ev.startTime || !ev.endTime || !ev.title) continue;
      lines.push('BEGIN:VEVENT');
      const uid = ev.eventId || ev.id || 'evt-' + Math.random().toString(36).slice(2);
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${isoToICSTime(now)}`);
      const s = ev.startTime instanceof Date ? ev.startTime : parseSJTUTime(ev.startTime);
      const e = ev.endTime instanceof Date ? ev.endTime : parseSJTUTime(ev.endTime);
      if (!s || !e) continue;
      lines.push(`DTSTART:${isoToICSTime(s)}`);
      lines.push(`DTEND:${isoToICSTime(e)}`);
      lines.push(`SUMMARY:${escapeICSText(ev.title || ev.summary || '')}`);
      if (ev.location) lines.push(`LOCATION:${escapeICSText(ev.location)}`);
      if (ev.status) lines.push(`STATUS:${escapeICSText(ev.status)}`);
      lines.push(`DESCRIPTION:${escapeICSText(JSON.stringify(ev))}`);
      lines.push('END:VEVENT');
    } catch (e) {
      console.warn('buildICS fail', e);
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Upload ICS to Radicale server
async function uploadToRadicale(ics, calendarName, settings) {
  const base = (settings.radicalBase || DEFAULTS.radicalBase).replace(/\/$/, '');
  const user = settings.radicalUsername || DEFAULTS.radicalUsername;
  const auth = settings.radicalAuth || '';
  const url = `${base}/${encodeURIComponent(user)}/${encodeURIComponent(calendarName)}.ics`;
  const headers = { 'Content-Type': 'text/calendar; charset=utf-8' };
  if (auth) headers['Authorization'] = auth;

  // 动态 host 权限检查（MV3 需有 host 权限才能直接 fetch，否则有些策略下会被阻止）
  const originPattern = buildOriginFromUrl(base);
  if (originPattern && chrome.permissions) {
    try {
      const ok = await new Promise((resolve)=>{
        chrome.permissions.contains({ origins:[originPattern] }, (has)=> resolve(!!has));
      });
      if(!ok){
        notifyAll('缺少服务器权限，请在设置中保存以申请：' + originPattern);
        throw new Error('缺少权限 ' + originPattern);
      }
    } catch(e){
      throw e;
    }
  }

  const put = await fetch(url, { method: 'PUT', headers, body: ics });
  if (put.status === 200 || put.status === 201 || put.status === 204) {
    await saveSettings({ lastSync: Date.now() });
    notifyAll('同步成功: ' + url);
    return { ok: true, url };
  }
  throw new Error('上传失败 ' + put.status);
}

function buildOriginFromUrl(raw){
  try { const u = new URL(raw); return `${u.protocol}//${u.hostname}${u.port?':'+u.port:''}/*`; } catch(_){ return null; }
}

// -----------------------------
// ICS Merge Support (for non-incremental servers)
// -----------------------------
function parseICSTime(val){
  if(!val) return null;
  // Expect format like 20240905T120000Z or with timezone omitted; we treat as UTC if Z else naive
  const m = String(val).trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if(!m) return null;
  const [_, y, mon, d, H, M, S] = m; // eslint-disable-line no-unused-vars
  return new Date(Date.UTC(Number(y), Number(mon)-1, Number(d), Number(H), Number(M), Number(S)));
}

function parseExistingICS(text){
  const events = [];
  if(!text) return events;
  const lines = text.split(/\r?\n/);
  let cur = null;
  for(const raw of lines){
    const line = raw.trim();
    if(line === 'BEGIN:VEVENT'){ cur = { rawProps:{} }; }
    else if(line === 'END:VEVENT'){ if(cur){ events.push(cur); cur=null; } }
    else if(cur){
      const idx = line.indexOf(':');
      if(idx>0){
        const keyPart = line.slice(0, idx); // may contain ;VALUE= etc.
        const value = line.slice(idx+1);
        const key = keyPart.split(';')[0].toUpperCase();
        cur.rawProps[key] = value;
        if(key === 'UID') cur.uid = value;
        if(key === 'SUMMARY') cur.title = value;
        if(key === 'DTSTART') cur.startTime = parseICSTime(value.replace(/Z$/, ''));
        if(key === 'DTEND') cur.endTime = parseICSTime(value.replace(/Z$/, ''));
        if(key === 'LOCATION') cur.location = value;
        if(key === 'DESCRIPTION') cur.description = value;
      }
    }
  }
  return events;
}

function normalizeForMerge(ev){
  // Build a signature for conflict detection (title + start + end + location)
  const s = ev.startTime instanceof Date ? ev.startTime.toISOString() : (ev.startTime?.toISOString?.()||'');
  const e = ev.endTime instanceof Date ? ev.endTime.toISOString() : (ev.endTime?.toISOString?.()||'');
  return `${(ev.title||'').trim()}|${s}|${e}|${(ev.location||'').trim()}`.toLowerCase();
}

function mergeEvents(existing, incoming){
  const map = new Map();
  // keep existing first
  for(const ev of existing){
    map.set(normalizeForMerge(ev), ev);
  }
  for(const ev of incoming){
    const sig = normalizeForMerge(ev);
    if(map.has(sig)){
      // If collisions, prefer incoming (assume fresher) but preserve UID if existing had
      const old = map.get(sig);
      const merged = { ...old, ...ev };
      if(old.uid && !merged.uid) merged.uid = old.uid;
      map.set(sig, merged);
    } else {
      map.set(sig, ev);
    }
  }
  return [...map.values()];
}

async function mergeUpload(calendarName, newEvents){
  const settings = await loadSettings();
  const base = (settings.radicalBase || DEFAULTS.radicalBase).replace(/\/$/, '');
  const user = settings.radicalUsername || DEFAULTS.radicalUsername;
  const auth = settings.radicalAuth || '';
  const url = `${base}/${encodeURIComponent(user)}/${encodeURIComponent(calendarName)}.ics`;
  const headers = {};
  if (auth) headers['Authorization'] = auth;
  let existingText = '';
  try {
    const res = await fetch(url, { method: 'GET', headers });
    if(res.ok) existingText = await res.text();
  } catch(e) {
    // ignore fetch failure; treat as empty
  }
  const existingParsed = parseExistingICS(existingText);
  const merged = mergeEvents(existingParsed, newEvents);
  const ics = buildICS(merged, calendarName);
  await uploadToRadicale(ics, calendarName, settings);
  notifyAll(`合并上传 ${newEvents.length} 条，最终总计 ${merged.length} 条 (${calendarName})`);
  return { total: merged.length, added: newEvents.length };
}

// Core sync sequence
async function runSync() {
  const settings = await loadSettings();
  try {
    const profile = await getProfile();
    if (!profile?.success || !profile?.data?.account) {
      notifyAll('未登录或获取账号失败');
      return;
    }
    const account = profile.data.account;
    const eventsResp = await getEventsWindow(settings.dateWindowDays || DEFAULTS.dateWindowDays);
    if (!eventsResp?.success) throw new Error('事件列表返回异常');
    const events = eventsResp.data?.events || [];
    const calName = `SJTU-${account}`;
    const ics = buildICS(events, calName);
    await uploadToRadicale(ics, calName, settings);
  } catch (e) {
    notifyAll('同步失败: ' + (e.message || e));
  }
}

// Broadcast notification to user (toast + system notification)
function notifyAll(text) {
  console.log('[SJTU Auto Calendar]', text);
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SJTU Auto Calendar',
    message: text.substring(0, 180),
  });
  chrome.runtime.sendMessage({ type: 'SJTU_CAL_TOAST', text }).catch(() => {});
}

// Message handlers
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'SYNC_NOW') {
    runSync().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'PARSE_LLM') {
    // 保持原 content 弹窗调用：解析 + 上传
    parseLLMAndUpload(msg.text)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'PARSE_LLM_ONLY') {
    parseLLMOnly(msg.text)
      .then((events) => sendResponse({ ok: true, events }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'UPLOAD_EVENTS') {
    uploadEventsList(msg.events)
      .then((count) => sendResponse({ ok: true, count }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'PAGE_PARSE_RUN_ONCE') {
    runPageParseOnce(msg.url, msg.calendarName)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  return undefined;
});

// Alarm trigger
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'AUTO_SYNC') runSync();
  if (a.name === 'PAGE_PARSE_AUTO') runPageParseScheduled();
});

// Ensure alarm exists
async function ensureAlarm() {
  const settings = await loadSettings();
  const mins = settings.autoSyncMinutes || DEFAULTS.autoSyncMinutes;
  chrome.alarms.create('AUTO_SYNC', { periodInMinutes: Math.max(1, Number(mins) || 60) });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  createMenus();
  ensurePageParseAlarm();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  ensurePageParseAlarm();
});
chrome.commands?.onCommand.addListener((command) => {
  if (command === 'parse-selection') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'SJTU_CAL_OPEN_PARSE_MODAL_FROM_SELECTION' });
    });
  } else if (command === 'sync-now') {
    runSync();
  }
});

// Context menus
function createMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.create({
    id: 'sjtu-parse-selection',
    title: 'SJTU: 日程解析',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'sjtu-sync-now',
    title: 'SJTU: 立即同步校历',
    contexts: ['action'],
  });
}

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'sjtu-parse-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'SJTU_CAL_OPEN_PARSE_MODAL_FROM_SELECTION' });
  }
  if (info.menuItemId === 'sjtu-sync-now') {
    runSync();
  }
});

// LLM parsing + upload
async function parseLLMAndUpload(rawText) {
  const settings = await loadSettings();
  const key = settings.llmApiKey;
  if (!key) throw new Error('未配置 LLM API Key');
  if (settings.llmProvider !== 'zhipu_agent') throw new Error('不支持的 provider');
  const agentId = settings.llmAgentId;
  if (!agentId) throw new Error('未配置 Agent ID');
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];
  const body = {
    app_id: agentId,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input',
            value: `今天的日期是 ${todayDate}，当前时间是 ${currentTime}。\n\n请解析以下文本为日程:\n${rawText}`,
          },
        ],
      },
    ],
    stream: false,
  };
  const resp = await fetch(settings.llmApiUrl || DEFAULTS.llmApiUrl, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('LLM 请求失败 ' + resp.status);
  const json = await resp.json();
  const content = json.choices?.[0]?.messages?.content?.msg;
  if (!content) throw new Error('LLM 返回空内容');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('解析 LLM JSON 失败');
  }
  if (!Array.isArray(parsed.events)) throw new Error('事件结构无效');
  for (const ev of parsed.events) {
    if (!ev.startTime || !ev.endTime || !ev.title) throw new Error('事件缺少字段');
  }
  const events = parsed.events.map((ev) => ({
    ...ev,
    startTime: parseLLMTime(ev.startTime),
    endTime: parseLLMTime(ev.endTime),
  }));
  // 增量合并上传
  const mergedInfo = await mergeUpload('LLM-Parsed', events);
  return { count: events.length, total: mergedInfo.total };
}

async function parseLLMOnly(rawText) {
  const settings = await loadSettings();
  const key = settings.llmApiKey;
  if (!key) throw new Error('未配置 LLM API Key');
  if (settings.llmProvider !== 'zhipu_agent') throw new Error('不支持的 provider');
  const agentId = settings.llmAgentId;
  if (!agentId) throw new Error('未配置 Agent ID');
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];
  const body = {
    app_id: agentId,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input',
            value: `今天的日期是 ${todayDate}，当前时间是 ${currentTime}。\n\n请解析以下文本为日程(以 JSON 返回，格式 {"events":[{"title":"","startTime":"YYYY-MM-DD HH:mm","endTime":"YYYY-MM-DD HH:mm","location":""}]}, 不要包含其他文字):\n${rawText}`,
          },
        ],
      },
    ],
    stream: false,
  };
  const resp = await fetch(settings.llmApiUrl || DEFAULTS.llmApiUrl, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('LLM 请求失败 ' + resp.status);
  const json = await resp.json();
  const content = json.choices?.[0]?.messages?.content?.msg;
  if (!content) throw new Error('LLM 返回空内容');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('解析 LLM JSON 失败');
  }
  if (!Array.isArray(parsed.events)) throw new Error('事件结构无效');
  return parsed.events.map((ev) => ({
    ...ev,
    startTime: ev.startTime,
    endTime: ev.endTime,
    startTimeRaw: ev.startTime,
    endTimeRaw: ev.endTime,
  }));
}

async function uploadEventsList(events) {
  if (!Array.isArray(events) || !events.length) throw new Error('事件为空');
  const settings = await loadSettings();
  const norm = events.map((ev) => {
    const s = parseLLMTime(ev.startTimeRaw) || parseSJTUTime(ev.startTime) || (ev.startTime instanceof Date ? ev.startTime : null);
    const e = parseLLMTime(ev.endTimeRaw) || parseSJTUTime(ev.endTime) || (ev.endTime instanceof Date ? ev.endTime : null);
    return { ...ev, startTime: s, endTime: e };
  });
  // 过滤/校验
  const valid = [];
  const dropped = [];
  for (const ev of norm) {
    if (!ev.title || !ev.startTime || !ev.endTime) dropped.push(ev); else valid.push(ev);
  }
  if (!valid.length) throw new Error('全部事件缺少字段或时间格式无法解析');
  const mergedInfo = await mergeUpload('LLM-Parsed', valid);
  if (dropped.length) notifyAll(`合并上传 ${valid.length} 条，丢弃 ${dropped.length} 条；当前日历共 ${mergedInfo.total} 条`);
  else notifyAll(`合并上传 ${valid.length} 条；当前日历共 ${mergedInfo.total} 条`);
  return valid.length;
}

// -----------------------------
// Page Parse (Scheduled / Manual)
// -----------------------------
async function ensurePageParseAlarm(){
  const settings = await loadSettings();
  if(!settings.pageParseEnabled){ chrome.alarms.clear('PAGE_PARSE_AUTO'); return; }
  const iv = Math.max(1, Number(settings.pageParseInterval) || 0);
  if(!iv || !settings.pageParseUrl){ chrome.alarms.clear('PAGE_PARSE_AUTO'); return; }
  chrome.alarms.create('PAGE_PARSE_AUTO', { periodInMinutes: iv });
}

chrome.storage?.onChanged.addListener((changes) => {
  if(changes.pageParseEnabled || changes.pageParseInterval || changes.pageParseUrl){
    ensurePageParseAlarm();
  }
});

async function runPageParseScheduled(){
  const settings = await loadSettings();
  if(!settings.pageParseEnabled) return;
  if(!settings.pageParseUrl){ notifyAll('页面解析跳过：未配置 URL'); return; }
  try {
    await runPageParseOnce(settings.pageParseUrl, settings.pageParseCalendarName || 'PAGE-PARSED');
  } catch(e){
    notifyAll('页面解析失败: ' + e.message);
  }
}

async function runPageParseOnce(url, calendarName){
  const settings = await loadSettings();
  const strategy = settings.pageParseStrategy || 'fetch'; // fetch | capture
  let text = '';
  if(strategy === 'capture') {
    try {
      text = await capturePageText(url);
    } catch(e){
      notifyAll('页面 capture 失败，回退到直接获取: '+ e.message);
      text = await fallbackFetchPage(url, console.log, console.warn);
    }
  } else {
    // fetch 模式：直接使用 fallbackFetchPage （无 DOM 执行, 最稳定）
    text = await fallbackFetchPage(url, console.log, console.warn);
    // 在 fetch 模式下尝试：若返回似乎是 JSON（或者用户选择 JSON 直取模式），则走 JSON 解析分支
    const jsonMode = settings.pageParseJsonMode || 'llm';
    let parsedEvents = null;
    if(jsonMode === 'json'){
      // 用户强制 JSON 直取，则先尝试 parse
      parsedEvents = await tryParseJsonEvents(text, settings);
    } else if(/^[\s\S]*\{[\s\S]*\}[\s\S]*$/.test(text.trim().slice(0,800))){
      // 内容看起来像含有 JSON 对象，且用户仍是 llm 模式：可选择仍交给 LLM；此处不自动 JSON 直取
    }
    if(parsedEvents){
      const info = await mergeUpload(calendarName || 'PAGE-PARSED', parsedEvents);
      notifyAll(`页面(JSON)解析完成: 新增 ${parsedEvents.length} 条（合并后总 ${info.total} 条）`);
      return { added: parsedEvents.length, total: info.total, json: true };
    }
  }
  const events = await parseTextViaLLM(text);
  const info = await mergeUpload(calendarName || 'PAGE-PARSED', events);
  notifyAll(`页面解析完成: 新增 ${events.length} 条（合并后总 ${info.total} 条）`);
  return { added: events.length, total: info.total };
}

// -----------------------------
// JSON 直取工具
// -----------------------------
function tokenizeJsonPath(path){
  // 支持 seg: key, key[index], key[*], [index], [*]
  // 拆成段：先按 '.' 分，再解析 []
  const parts = [];
  const segs = path.split('.').map(s=>s.trim()).filter(Boolean);
  for(const seg of segs){
    let rest = seg;
    // 先匹配纯 key (可能后跟 [..] 多段)
    const mKey = rest.match(/^([A-Za-z0-9_]+)(.*)$/);
    if(mKey){
      parts.push({ type:'key', key:mKey[1] });
      rest = mKey[2];
    }
    // 处理后续 [..] 串
    while(rest.length){
      const mIndex = rest.match(/^\[(\d+)\](.*)$/);
      if(mIndex){ parts.push({ type:'index', index:Number(mIndex[1])}); rest = mIndex[2]; continue; }
      const mAll = rest.match(/^\[\*\](.*)$/);
      if(mAll){ parts.push({ type:'wildcard'}); rest = mAll[1]; continue; }
      // 如果一开始就是 [index] 而无 key 部分
      const mStartIndex = rest.match(/^\[(\d+)\](.*)$/);
      if(mStartIndex){ parts.push({ type:'index', index:Number(mStartIndex[1])}); rest = mStartIndex[2]; continue; }
      break; // 非法剩余，退出
    }
    if(!mKey){
      // seg 形如 [0] 或 [*]
      if(/^\[(\d+)\]$/.test(seg)){ parts.push({ type:'index', index:Number(RegExp.$1)}); }
      else if(seg === '[*]'){ parts.push({ type:'wildcard'}); }
    }
  }
  return parts;
}

function evaluateSinglePath(root, pathSpec){
  const tokens = tokenizeJsonPath(pathSpec);
  let current = [root];
  for(const tk of tokens){
    const next = [];
    for(const node of current){
      if(tk.type === 'key'){
        if(node && Object.prototype.hasOwnProperty.call(node, tk.key)) next.push(node[tk.key]);
      } else if(tk.type === 'index'){
        if(Array.isArray(node) && node.length > tk.index) next.push(node[tk.index]);
      } else if(tk.type === 'wildcard'){
        if(Array.isArray(node)) next.push(...node);
      }
    }
    current = next;
    if(!current.length) break;
  }
  return current;
}

function evaluateJsonPaths(json, paths){
  const all = [];
  for(const p of paths){
    const trimmed = p.trim();
    if(!trimmed) continue;
    try {
      const vals = evaluateSinglePath(json, trimmed);
      all.push(...vals);
    } catch(e){
      console.warn('evaluate path failed', trimmed, e.message);
    }
  }
  return all;
}

async function tryParseJsonEvents(text, settings){
  let obj = null;
  try { obj = JSON.parse(text); } catch { return null; }
  const rawPaths = (settings.pageParseJsonPaths || '').split(/\n+/);
  const candidates = evaluateJsonPaths(obj, rawPaths);
  const events = [];
  for(const c of candidates){
    if(!c || typeof c !== 'object') continue;
    // 如果是数组则展开
    if(Array.isArray(c)){
      for(const item of c){ collectEventCandidate(item, events); }
    } else {
      collectEventCandidate(c, events);
    }
  }
  const valid = events.filter(e => e.title && e.startTime && e.endTime);
  return valid.length ? valid : null;
}

function collectEventCandidate(obj, out){
  if(!obj || typeof obj !== 'object') return;
  const title = obj.title || obj.summary || obj.name;
  const startTime = obj.startTime || obj.begin || obj.start;
  const endTime = obj.endTime || obj.end || obj.finish;
  if(!(title && startTime && endTime)) return;
  out.push({
    title: String(title),
    startTime: parseSJTUTime(startTime) || parseLLMTime(startTime) || startTime,
    endTime: parseSJTUTime(endTime) || parseLLMTime(endTime) || endTime,
    location: obj.location || obj.place || '',
    status: obj.status || '',
    raw: obj,
  });
}

async function capturePageText(targetUrl){
  const tab = await new Promise((resolve) => {
    chrome.tabs.query({ url: targetUrl }, (tabs) => {
      if(tabs && tabs.length) return resolve(tabs[0]);
      chrome.tabs.create({ url: targetUrl, active: false }, (t) => resolve(t));
    });
  });
  if(!tab?.id) throw new Error('无法创建/获取标签');
  await waitTabComplete(tab.id, 20000);
  let text = '';
  const traceId = 'PP-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,6);
  const started = performance.now?.() || Date.now();
  const log = (...args) => console.log('[PageParse]', traceId, ...args);
  const warn = (...args) => console.warn('[PageParse]', traceId, ...args);
  log('Begin capturePageText', { targetUrl, tabId: tab.id, status: tab.status });

  const sendCapture = (phase) => new Promise((resolve, reject) => {
    const t0 = performance.now?.() || Date.now();
    try {
      chrome.tabs.sendMessage(tab.id, { type:'SJTU_CAL_CAPTURE_TEXT', _trace: traceId, _phase: phase }, (resp) => {
        const elapsed = (performance.now?.() || Date.now()) - t0;
        if(chrome.runtime.lastError){
          warn(phase, 'lastError', chrome.runtime.lastError.message, 'elapsed(ms)=', elapsed);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if(!resp){
          warn(phase, 'no response object', 'elapsed(ms)=', elapsed);
          return reject(new Error('无响应对象'));
        }
        if(!resp.ok){
          warn(phase, 'resp not ok', resp.error, 'elapsed(ms)=', elapsed);
          return reject(new Error(resp.error || '采集失败'));
        }
        log(phase, 'success length=', (resp.text||'').length, 'elapsed(ms)=', elapsed);
        resolve(resp.text || '');
      });
    } catch(e){
      warn(phase, 'sendMessage threw', e.message);
      reject(e);
    }
  });

  try {
    text = await sendCapture('first');
  } catch(e){
    // 可能 content script 未注入 => 动态注入再试一次
    if(e.message && e.message.includes('Could not establish connection')){
      log('Need dynamic inject content script because first attempt failed:', e.message);
      try {
        await chrome.scripting.executeScript({ target:{ tabId: tab.id }, files:['src/content.js'] });
        log('Dynamic inject done, retrying');
        text = await sendCapture('retry');
      } catch(e2){
        warn('retry failed', e2.message, 'attempting frame enumeration');
        // 多 frame 注入再试一次
        try {
          const frames = await new Promise((resolve) => {
            try { chrome.webNavigation.getAllFrames({ tabId: tab.id }, resolve); } catch(_){ resolve([]); }
          });
          if(Array.isArray(frames) && frames.length){
            log('Enumerated frames count=', frames.length);
            for(const f of frames){
              try {
                await chrome.scripting.executeScript({ target:{ tabId: tab.id, frameIds:[f.frameId] }, files:['src/content.js'] });
              } catch(frameErr){ warn('inject frame failed', f.frameId, frameErr.message); }
            }
            try {
              text = await sendCapture('retry-frames');
            } catch(e3){
              warn('retry-frames failed', e3.message, 'fallback to direct fetch');
              text = await fallbackFetchPage(targetUrl, log, warn);
            }
          } else {
            warn('no frames enumerated, fallback to direct fetch');
            text = await fallbackFetchPage(targetUrl, log, warn);
          }
        } catch(enumErr){
          warn('frame enumeration failed', enumErr.message, 'fallback to direct fetch');
          text = await fallbackFetchPage(targetUrl, log, warn);
        }
      }
    } else {
      warn('first attempt failed (non-inject reason)', e.message);
      throw e;
    }
  }
  const totalElapsed = (performance.now?.() || Date.now()) - started;
  log('Finished capturePageText, final length=', text.length, 'totalElapsed(ms)=', totalElapsed);
  return text;
}

function waitTabComplete(tabId, timeoutMs){
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if(Date.now() - start > timeoutMs){ clearInterval(timer); reject(new Error('加载超时')); }
      chrome.tabs.get(tabId, (t) => {
        if(!t) return; // closed
        if(t.status === 'complete'){ clearInterval(timer); resolve(); }
      });
    }, 500);
  });
}

async function parseTextViaLLM(rawText){
  const settings = await loadSettings();
  const key = settings.llmApiKey;
  if(!key) throw new Error('未配置 LLM API Key');
  if(settings.llmProvider !== 'zhipu_agent') throw new Error('不支持的 provider');
  const agentId = settings.llmAgentId; if(!agentId) throw new Error('未配置 Agent ID');
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];
  const body = {
    app_id: agentId,
    messages: [ { role:'user', content:[ { type:'input', value:`今天的日期是 ${todayDate}，当前时间是 ${currentTime}。\n\n请从以下页面文本中提取日程 (JSON: {"events":[{"title":"","startTime":"YYYY-MM-DD HH:mm","endTime":"YYYY-MM-DD HH:mm","location":""}]}, 不要输出额外解释) ：\n${rawText.slice(0,4000)}` } ] } ],
    stream:false,
  };
  const resp = await fetch(settings.llmApiUrl || DEFAULTS.llmApiUrl, {
    method:'POST',
    headers:{ Authorization:'Bearer ' + key, 'Content-Type':'application/json' },
    body: JSON.stringify(body),
  });
  if(!resp.ok) throw new Error('LLM 请求失败 ' + resp.status);
  const json = await resp.json();
  const content = json.choices?.[0]?.messages?.content?.msg;
  if(!content) throw new Error('LLM 返回空内容');
  let parsed; try { parsed = JSON.parse(content); } catch { throw new Error('解析 LLM JSON 失败'); }
  if(!Array.isArray(parsed.events)) throw new Error('事件结构无效');
  const events = parsed.events.map(ev => ({
    ...ev,
    startTime: parseLLMTime(ev.startTime),
    endTime: parseLLMTime(ev.endTime),
  })).filter(ev => ev.startTime && ev.endTime && ev.title);
  return events;
}

// Fallback: direct fetch page HTML (no JS execution). We strip tags to approximate visible text.
async function fallbackFetchPage(url, log, warn){
  try {
    const res = await fetch(url, { credentials:'include' });
    if(!res.ok){ warn('fallback fetch status', res.status); return ''; }
    const html = await res.text();
    // Very naive strip; keeps some spacing
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi,' ')
      .replace(/<style[\s\S]*?<\/style>/gi,' ')
      .replace(/<[^>]+>/g,'\n')
      .replace(/&nbsp;/g,' ')
      .replace(/[\t ]+/g,' ')
      .replace(/\n{2,}/g,'\n')
      .trim();
    log('fallbackFetchPage length=', text.length);
    return text;
  } catch(e){
    warn('fallback fetch error', e.message);
    return '';
  }
}
