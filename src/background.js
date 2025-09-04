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
  return undefined;
});

// Alarm trigger
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'AUTO_SYNC') runSync();
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
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
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
