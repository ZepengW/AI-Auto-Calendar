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

  const put = await fetch(url, { method: 'PUT', headers, body: ics });
  if (put.status === 200 || put.status === 201 || put.status === 204) {
    await saveSettings({ lastSync: Date.now() });
    notifyAll('同步成功: ' + url);
    return { ok: true, url };
  }
  throw new Error('上传失败 ' + put.status);
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
  const ics = buildICS(events, 'LLM-Parsed');
  await uploadToRadicale(ics, 'LLM-Parsed', settings);
  notifyAll(`成功解析并上传 ${events.length} 个事件`);
  return { count: events.length };
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
  // 验证基础字段
  for (const ev of events) {
    if (!ev.startTime || !ev.endTime || !ev.title) throw new Error('事件缺少字段');
  }
  const settings = await loadSettings();
  const norm = events.map((ev) => ({
    ...ev,
    startTime: parseLLMTime(ev.startTime),
    endTime: parseLLMTime(ev.endTime),
  }));
  const ics = buildICS(norm, 'LLM-Parsed');
  await uploadToRadicale(ics, 'LLM-Parsed', settings);
  notifyAll(`上传 ${norm.length} 条事件至 LLM-Parsed`);
  return norm.length;
}
