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
import { loadParsers, saveParsers, getParserById, parseWithParser } from './parsers.js';
import { loadServers, saveServers, getServerById, mergeUploadWithServer } from './servers.js';

// -------------------------------------------------
// 新版多任务模型 (V3)
// tasks (存储键: pageTasks): Array<{
//   id: string;
//   name: string;             // 任务名称（管理用）
//   calendarName: string;     // 上传到 Radicale 的日历文件前缀/名称
//   enabled: boolean;
//   scheduleType: 'interval'|'times'; // 旧版单选，保留兼容
//   // 新版可多选触发：
//   useInterval: boolean;
//   intervalMinutes: number;  // useInterval 时有效
//   useTimes: boolean;
//   times: string[];          // useTimes 时有效，格式 HH:mm
//   visitTrigger: boolean;    // 访问页面触发
//   visitPatterns: string[];  // 可选，前缀匹配；为空则默认使用 modeConfig.url
//   mode: 'HTTP_GET_JSON';    // 数据获取模式（目前仅支持这一种）
//   modeConfig: {             // 模式配置
//     url: string;            // 目标 URL (HTTP GET)
//     jsonPaths: string;      // 多行 JSON 路径 (同旧版)
//     parseMode: 'llm'|'direct'; // deprecated from UI; inferred by parserId or legacy data
//   };
// }>
// 旧版迁移：
// - pageParseTasks / legacy 单任务字段 -> 生成 scheduleType=interval 的新任务；calendarName = 旧 name / pageParseCalendarName；parseMode 映射 jsonMode=json->direct
// - 删除旧的 pageParse* 与 pageParseTasks 键

async function loadAllSettingsWithTaskMigration(){
  const s = await loadSettings();
  let changed = false;
  if(!Array.isArray(s.pageTasks)){
    const legacyTasks = Array.isArray(s.pageParseTasks) ? s.pageParseTasks : [];
    const out = [];
    if(legacyTasks.length){
      for(const t of legacyTasks){
        out.push(convOldTask(t));
      }
    } else if(s.pageParseUrl){
      // 单任务迁移
      out.push(convLegacySingle(s));
    }
    s.pageTasks = out;
    changed = true;
  }
  // 清理旧键
  const oldKeys = ['pageParseTasks','pageParseUrl','pageParseInterval','pageParseCalendarName','pageParseEnabled','pageParseStrategy','pageParseJsonMode','pageParseJsonPaths'];
  const patch = { pageTasks: s.pageTasks };
  for(const k of oldKeys){ if(k in s){ patch[k] = undefined; changed = true; } }
  if(changed) await saveSettings(patch);
  return s;
}

function convOldTask(t){
  return {
    id: t.id || ('migr-'+Math.random().toString(36).slice(2)),
    name: t.name || '任务',
    calendarName: t.name || 'PAGE-PARSED',
    enabled: !!t.enabled,
    scheduleType: 'interval',
    useInterval: true,
    intervalMinutes: Math.max(1, Number(t.interval)||60),
    useTimes: false,
    times: [],
    visitTrigger: false,
    visitPatterns: [],
    mode: 'HTTP_GET_JSON',
    modeConfig: {
      url: t.url || '',
      jsonPaths: t.jsonPaths || 'data.events[*]',
      parseMode: t.jsonMode === 'json' ? 'direct':'llm',
    },
  };
}

function convLegacySingle(s){
  return {
    id: 'legacy-single',
    name: s.pageParseCalendarName || 'PAGE-PARSED',
    calendarName: s.pageParseCalendarName || 'PAGE-PARSED',
    enabled: !!s.pageParseEnabled,
    scheduleType: 'interval',
    useInterval: true,
    intervalMinutes: Math.max(1, Number(s.pageParseInterval)||60),
    useTimes: false,
    times: [],
    visitTrigger: false,
    visitPatterns: [],
    mode: 'HTTP_GET_JSON',
    modeConfig: {
      url: s.pageParseUrl || '',
      jsonPaths: s.pageParseJsonPaths || 'data.events[*]',
      parseMode: (s.pageParseJsonMode === 'json') ? 'direct':'llm',
    },
  };
}

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
  if (ev.description) lines.push(`DESCRIPTION:${escapeICSText(String(ev.description))}`);
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
    // Use selected server node if set; fallback handled inside
    await uploadWithSelectedServer(events, calName, settings.selectedServerId);
  } catch (e) {
    notifyAll('同步失败: ' + (e.message || e));
  }
}

// Broadcast notification to user (toast + system notification)
function notifyAll(text) {
  console.log('[SJTU Auto Calendar]', text);
  // Use existing icon if available, fall back if missing
  const iconPath = 'icons/icon.png';
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: iconPath,
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
    parseLLMAndUpload(msg.text, msg.serverId)
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
    uploadEventsList(msg.events, msg.serverId)
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
  if (msg?.type === 'GET_PAGE_TASKS') {
    loadAllSettingsWithTaskMigration()
      .then((s) => sendResponse({ ok: true, tasks: s.pageTasks || [] }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'GET_PARSERS') {
    (async () => {
      const list = await loadParsers();
      sendResponse({ ok: true, parsers: list });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'GET_SERVERS') {
    (async () => {
      const list = await loadServers();
      sendResponse({ ok: true, servers: list });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'SAVE_SERVERS') {
    (async () => {
      const list = await saveServers(Array.isArray(msg.servers) ? msg.servers : []);
      sendResponse({ ok: true, servers: list });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'SAVE_PARSERS') {
    (async () => {
      const list = await saveParsers(Array.isArray(msg.parsers) ? msg.parsers : []);
      sendResponse({ ok: true, parsers: list });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'PARSE_TEXT_WITH_PARSER') {
    (async () => {
      const parser = await getParserById(msg.parserId);
      if (!parser) throw new Error('解析器未找到');
      const events = await parseWithParser(String(msg.text||''), parser, { jsonPaths: msg.jsonPaths });
      sendResponse({ ok: true, events });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'SAVE_PAGE_TASKS') {
    (async () => {
      const tasks = Array.isArray(msg.tasks) ? sanitizeNewTasks(msg.tasks) : [];
      await saveSettings({ pageTasks: tasks });
      await ensureAllPageTaskAlarms();
      sendResponse({ ok: true });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'RUN_PAGE_TASK') {
    (async () => {
      const s = await loadAllSettingsWithTaskMigration();
      const task = (s.pageTasks || []).find((t) => t.id === msg.id);
      if (!task) throw new Error('任务不存在');
      const result = await runTaskWithLogging(task, 'manual', { source: 'popup/options' });
      sendResponse({ ok: true, ...result });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'GET_TASK_LOGS') {
    (async () => {
      const limit = Math.max(1, Math.min(Number(msg.limit) || 200, 1000));
      const logs = await getTaskLogs(limit);
      sendResponse({ ok: true, logs });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'CLEAR_TASK_LOGS') {
    (async () => {
      await saveSettings({ pageTaskLogs: [] });
      sendResponse({ ok: true });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'REBUILD_PAGE_TASK_ALARMS') {
    (async () => {
      await ensureAllPageTaskAlarms();
      sendResponse({ ok: true });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'DEBUG_LIST_ALARMS') {
    (async () => {
      const all = await chrome.alarms.getAll();
      sendResponse({ ok: true, alarms: all.map((a) => ({ name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes })) });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return undefined;
});

// Alarm trigger
chrome.alarms.onAlarm.addListener((a) => {
  console.log('[SJTU] onAlarm', a.name, 'at', new Date().toISOString());
  if (a.name === 'AUTO_SYNC') runSync();
  if (a.name === 'PAGE_PARSE_AUTO') runPageParseScheduled(); // legacy safeguard
  if (a.name.startsWith('PAGE_TASK_INTERVAL_')){
    const id = a.name.slice('PAGE_TASK_INTERVAL_'.length);
    triggerPageTaskById(id, undefined, false, 'interval');
  }
  if (a.name.startsWith('PAGE_TASK_TIME_')){
    // 格式: PAGE_TASK_TIME_<taskId>_<index>
    const parts = a.name.split('_');
    const taskId = parts[3];
    const idx = Number(parts[4]);
    triggerPageTaskById(taskId, idx, true, 'time');
  }
});

// Ensure alarm exists
async function ensureAlarm() {
  const settings = await loadSettings();
  const mins = settings.autoSyncMinutes || DEFAULTS.autoSyncMinutes;
  chrome.alarms.create('AUTO_SYNC', { periodInMinutes: Math.max(1, Number(mins) || 60) });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SJTU] onInstalled -> ensureAlarm & ensureAllPageTaskAlarms');
  ensureAlarm();
  createMenus();
  ensureAllPageTaskAlarms();
  setupUrlVisitTrigger();
});
chrome.runtime.onStartup.addListener(() => {
  console.log('[SJTU] onStartup -> ensureAlarm & ensureAllPageTaskAlarms');
  ensureAlarm();
  ensureAllPageTaskAlarms();
  setupUrlVisitTrigger();
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

// Choose default parser node when none specified: prefer first configured parser
async function getDefaultParser() {
  const list = await loadParsers();
  if (!Array.isArray(list) || !list.length) return null;
  return list[0];
}

// LLM parsing + upload via default parser node
async function parseLLMAndUpload(rawText, serverId) {
  const parser = await getDefaultParser();
  if (!parser) throw new Error('未配置解析节点，请先在设置中添加解析节点');
  const events = await parseWithParser(String(rawText||''), parser, {});
  const { total } = await uploadWithSelectedServer(events, 'LLM-Parsed', serverId);
  return { count: events.length, total };
}

async function parseLLMOnly(rawText) {
  const parser = await getDefaultParser();
  if (!parser) throw new Error('未配置解析节点，请先在设置中添加解析节点');
  const events = await parseWithParser(String(rawText||''), parser, {});
  // keep raw fields for UI edit page compatibility
  return events.map(ev => ({
    ...ev,
    startTimeRaw: ev.startTimeRaw || ev.startTime,
    endTimeRaw: ev.endTimeRaw || ev.endTime,
  }));
}

async function uploadEventsList(events, serverId) {
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
  const { total } = await uploadWithSelectedServer(valid, 'LLM-Parsed', serverId);
  if (dropped.length) notifyAll(`合并上传 ${valid.length} 条，丢弃 ${dropped.length} 条；当前日历共 ${total} 条`);
  else notifyAll(`合并上传 ${valid.length} 条；当前日历共 ${total} 条`);
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
  if(changes.pageTasks){
    // Recompute all task alarms when tasks updated via storage
    ensureAllPageTaskAlarms();
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
      const { total } = await uploadWithSelectedServer(parsedEvents, calendarName || 'PAGE-PARSED', settings.selectedServerId);
      notifyAll(`页面(JSON)解析完成: 新增 ${parsedEvents.length} 条（合并后总 ${total} 条）`);
      return { added: parsedEvents.length, total, json: true };
    }
  }
  const events = await parseTextViaLLM(text);
  const { total } = await uploadWithSelectedServer(events, calendarName || 'PAGE-PARSED', settings.selectedServerId);
  notifyAll(`页面解析完成: 新增 ${events.length} 条（合并后总 ${total} 条）`);
  return { added: events.length, total };
}

// -----------------------------
// 多任务执行辅助
// -----------------------------
async function ensureAllPageTaskAlarms(){
  const s = await loadAllSettingsWithTaskMigration();
  const existing = await chrome.alarms.getAll();
  console.log('[SJTU] ensureAllPageTaskAlarms existing=', existing.map(a=>a.name));
  for(const a of existing){
    if(a.name.startsWith('PAGE_TASK_INTERVAL_') || a.name.startsWith('PAGE_TASK_TIME_')) chrome.alarms.clear(a.name);
  }
  for(const t of (s.pageTasks||[])){
    if(!t.enabled) continue;
    const wantInterval = (t.useInterval === true) || (t.useInterval === undefined && t.scheduleType === 'interval');
    const wantTimes = (t.useTimes === true) || (t.useTimes === undefined && t.scheduleType === 'times');
    if(wantInterval){
      const iv = Math.max(1, Number(t.intervalMinutes)||0);
      if(!iv || !t.modeConfig?.url) continue;
      chrome.alarms.create('PAGE_TASK_INTERVAL_'+t.id, { periodInMinutes: iv });
      console.log('[SJTU] created interval alarm for', t.id, 'every', iv, 'min');
    }
    if(wantTimes) {
      if(!Array.isArray(t.times) || !t.times.length || !t.modeConfig?.url) continue;
      t.times.forEach((tm, idx)=>{
        const when = computeNextTimePoint(tm);
        if(when) {
          chrome.alarms.create(`PAGE_TASK_TIME_${t.id}_${idx}`, { when: when.getTime() });
          console.log('[SJTU] scheduled time alarm', tm, 'for task', t.id, 'at', when.toISOString());
        }
      });
    }
  }
}

function computeNextTimePoint(hhmm){
  if(!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [H,M] = hhmm.split(':').map(Number);
  const now = new Date();
  const d = new Date();
  d.setHours(H, M, 0, 0);
  if(d.getTime() <= now.getTime()) d.setDate(d.getDate()+1); // 下一天
  return d;
}

async function triggerPageTaskById(id, timeIndex, isTimeAlarm){
  try {
    const s = await loadAllSettingsWithTaskMigration();
    const task = (s.pageTasks||[]).find(t=> t.id === id);
    if(!task) return notifyAll('任务不存在: '+ id);
    if(!task.enabled) return; // 禁用
    await runTaskWithLogging(task, isTimeAlarm ? 'time' : 'interval', { timeIndex, time: (Array.isArray(task.times)? task.times[timeIndex]: undefined) });
    // 若是 times 模式的单次闹钟，需要重新排程下一次
    if(isTimeAlarm && task.scheduleType === 'times' && typeof timeIndex === 'number'){
      const tt = task.times?.[timeIndex];
      if(tt){
        const when = computeNextTimePoint(tt);
        if(when) chrome.alarms.create(`PAGE_TASK_TIME_${task.id}_${timeIndex}`, { when: when.getTime() });
      }
    }
  } catch(e){
    notifyAll('任务执行失败: ' + e.message);
  }
}

function sanitizeNewTasks(tasks){
  // 基础字段约束 & 过滤无 URL
  return tasks.map(t => ({
    id: t.id || ('task-'+Math.random().toString(36).slice(2)),
    name: t.name || '任务',
    calendarName: t.calendarName || t.name || 'PAGE-PARSED',
    enabled: !!t.enabled,
    scheduleType: (t.scheduleType === 'times' ? 'times':'interval'),
    // 新版触发：多选
    useInterval: !!t.useInterval,
    intervalMinutes: Math.max(1, Number(t.intervalMinutes)|| (Number(t.interval)||60) ),
    useTimes: !!t.useTimes,
    times: Array.isArray(t.times)? t.times.filter(x=>/^\d{2}:\d{2}$/.test(x)) : [],
    visitTrigger: !!t.visitTrigger,
    visitPatterns: Array.isArray(t.visitPatterns) ? t.visitPatterns.filter(s=> typeof s === 'string' && s.trim()).map(s=>s.trim()) : [],
    mode: 'HTTP_GET_JSON',
    modeConfig: {
      url: t.modeConfig?.url || t.url || '',
      jsonPaths: t.modeConfig?.jsonPaths || t.jsonPaths || 'data.events[*]',
      parserId: t.modeConfig?.parserId || t.parserId || undefined,
  // parseMode no longer set by UI; keep legacy compatibility if present
  parseMode: (t.modeConfig?.parseMode || (t.jsonMode==='json'?'direct':'llm') || 'llm') === 'direct' ? 'direct':'llm',
    },
    serverId: t.serverId || undefined,
  })).filter(t => t.modeConfig.url);
}

async function runSinglePageTask(task){
  if(task.mode !== 'HTTP_GET_JSON') throw new Error('不支持的模式');
  const { calendarName, modeConfig } = task;
  const url = modeConfig.url;
  if(!url) throw new Error('URL 为空');
  // If parserId specified, use parser exclusively
  if (modeConfig.parserId) {
    const parser = await getParserById(modeConfig.parserId);
    if (!parser) throw new Error('解析器不存在: ' + modeConfig.parserId);
    // Fetch strategy: json_mapping needs raw JSON; LLM parsers prefer visible text
    let text = '';
    try {
      if (parser.type === 'json_mapping') {
        const r = await httpFetch(url);
        text = r.text || '';
      } else {
        text = await fallbackFetchPage(url, console.log, console.warn);
      }
    } catch { text=''; }
    const eventsParsed = await parseWithParser(text, parser, { jsonPaths: modeConfig.jsonPaths });
    const { total } = await uploadWithSelectedServer(eventsParsed || [], calendarName, task.serverId);
    notifyAll(`任务 ${calendarName} (parser:${parser.name||parser.type}) 完成: +${(eventsParsed||[]).length} (总${total})`);
    return { added: (eventsParsed||[]).length, total, direct: parser.type === 'json_mapping' };
  }
  // No explicit parser: choose fetch by parseMode
  let text = '';
  if (modeConfig.parseMode === 'direct'){
    try { const r = await httpFetch(url); text = r.text || ''; } catch { text=''; }
  } else {
    try { text = await fallbackFetchPage(url, console.log, console.warn); } catch { text=''; }
  }
  if(modeConfig.parseMode === 'direct'){
    const pseudoSettings = { pageParseJsonPaths: modeConfig.jsonPaths };
    const events = await tryParseJsonEvents(text, pseudoSettings) || [];
    if(events.length){
      const info = await mergeUpload(calendarName || 'PAGE-PARSED', events);
      notifyAll(`任务 ${calendarName} (direct) 完成: +${events.length} (总${info.total})`);
      return { added: events.length, total: info.total, direct:true };
    }
    // direct 失败则尝试 LLM 兜底
  }
  // LLM 模式：若提供 JSON 路径且原始文本是 JSON，先裁剪以减少噪声
  let llmInput = text;
  if(modeConfig.jsonPaths){
    const narrowed = narrowTextByJsonPaths(text, modeConfig.jsonPaths);
    if(narrowed) llmInput = narrowed;
  }
  const eventsLLM = await parseTextViaLLM(llmInput);
  const { total: total2 } = await uploadWithSelectedServer(eventsLLM, calendarName, task.serverId);
  notifyAll(`任务 ${calendarName} 完成: +${eventsLLM.length} (总${total2})`);
  return { added: eventsLLM.length, total: total2 };
}

async function uploadWithSelectedServer(events, calendarName, serverId){
  const settings = await loadSettings();
  // preference: task.serverId -> global selectedServerId -> fallback legacy radical
  const prefId = serverId || settings.selectedServerId;
  if (prefId){
    let server = null;
    try { server = await getServerById(prefId); } catch(_) {}
    if (server){
      const r = await mergeUploadWithServer(events, calendarName || 'PAGE-PARSED', server);
      return { total: r.total };
    }
  }
  const info = await mergeUpload(calendarName || 'PAGE-PARSED', events);
  return { total: info.total };
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

// 供 LLM 模式调用：若原文本是 JSON，根据路径抽取匹配节点集合并序列化为精简 JSON 片段
function narrowTextByJsonPaths(rawText, pathsStr){
  if(!rawText || !pathsStr) return null;
  const trimmed = rawText.trim();
  if(!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null; // 不是 JSON
  let obj; try { obj = JSON.parse(trimmed); } catch { return null; }
  const rawPaths = pathsStr.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  if(!rawPaths.length) return null;
  const collected = [];
  for(const p of rawPaths){
    if(!p) continue;
    let vals;
    try { vals = evaluateSinglePath(obj, p); } catch { continue; }
    if(!vals || !vals.length) continue;
    const explicitArrayMatch = /(\[(?:\d+|\*)\])\s*$/.test(p);
    for(const v of vals){
      if(Array.isArray(v)){
        if(explicitArrayMatch){
          for(const item of v){ collected.push(item); if(collected.length>=200) break; }
        } else {
          collected.push(v);
        }
      } else {
        collected.push(v);
      }
      if(collected.length>=200) break;
    }
    if(collected.length>=200) break;
  }
  if(!collected.length) return null;
  const snippet = JSON.stringify(collected.slice(0,200), null, 2);
  return snippet.length > 18000 ? snippet.slice(0,18000) : snippet;
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
  const parser = await getDefaultParser();
  if (!parser) throw new Error('未配置解析节点，请先在设置中添加解析节点');
  const events = await parseWithParser(String(rawText||''), parser, {});
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

// ---------------------------------
// URL-visit trigger (webNavigation)
// ---------------------------------
let _urlVisitCooldown = new Map(); // key: taskId -> lastRunTs

function normalizeUrl(u){
  try { const x = new URL(u); return x.origin + x.pathname; } catch { return u; }
}

function setupUrlVisitTrigger(){
  try {
    if(!chrome.webNavigation?.onCommitted) return;
    // Remove previous listeners to avoid duplication on SW restart
    chrome.webNavigation.onCommitted.removeListener(_onCommittedHandler);
    chrome.webNavigation.onCommitted.addListener(_onCommittedHandler);
    console.log('[SJTU] webNavigation onCommitted listener attached');
  } catch(e){
    console.warn('[SJTU] setupUrlVisitTrigger failed', e.message);
  }
}

async function _onCommittedHandler(details){
  try {
    if(details.frameId !== 0) return; // only main frame
    const urlNorm = normalizeUrl(details.url || '');
    const s = await loadAllSettingsWithTaskMigration();
    const tasks = (s.pageTasks||[]).filter(t => t.enabled && t.mode === 'HTTP_GET_JSON' && t.visitTrigger === true);
    if(!tasks.length) return;
    for(const t of tasks){
      // Determine patterns set: explicit visitPatterns or fallback to task URL
      const pats = (Array.isArray(t.visitPatterns) && t.visitPatterns.length ? t.visitPatterns : (t.modeConfig?.url ? [t.modeConfig.url] : []));
      if(!pats.length) continue;
      // prefix match on origin+pathname
      const matched = pats.some(p => {
        const base = normalizeUrl(p);
        if(!base) return false;
        return urlNorm.startsWith(base);
      });
      if(matched){
        const last = _urlVisitCooldown.get(t.id) || 0;
        const now = Date.now();
        // Cooldown 3 minutes to avoid loops when task fetches same URL etc.
        if(now - last < 3*60*1000) continue;
        _urlVisitCooldown.set(t.id, now);
        console.log('[SJTU] URL visit matched task', t.id, '-> runSinglePageTask');
        try { await runTaskWithLogging(t, 'visit', { url: details.url }); } catch(e){ notifyAll('URL触发任务失败: ' + e.message); }
      }
    }
  } catch(e){
    console.warn('[SJTU] onCommitted handler error', e.message);
  }
}

// ---------------------------------
// Task Logging (persisted ring buffer)
// ---------------------------------
async function appendTaskLog(entry){
  try {
    const s = await loadSettings();
    const list = Array.isArray(s.pageTaskLogs) ? s.pageTaskLogs : [];
    list.push(entry);
    const MAX = 1000;
    const trimmed = list.length > MAX ? list.slice(list.length-MAX) : list;
    await saveSettings({ pageTaskLogs: trimmed });
  } catch(_){}
}

async function getTaskLogs(limit=200){
  const s = await loadSettings();
  const list = Array.isArray(s.pageTaskLogs) ? s.pageTaskLogs : [];
  const out = list.slice(-limit).reverse();
  return out;
}

async function runTaskWithLogging(task, triggerType, info){
  const start = Date.now();
  const base = { ts: start, type: 'trigger', triggerType, taskId: task.id, taskName: task.name || task.calendarName || task.id, info };
  await appendTaskLog(base);
  try {
    const result = await runSinglePageTask(task);
    const done = Date.now();
    await appendTaskLog({ ts: done, type: 'result', triggerType, taskId: task.id, taskName: task.name || task.calendarName || task.id, durationMs: done-start, ok: true, added: result.added||0, total: result.total||0, mode: result.direct ? 'direct':'llm' });
    return result;
  } catch(e){
    const done = Date.now();
    await appendTaskLog({ ts: done, type: 'result', triggerType, taskId: task.id, taskName: task.name || task.calendarName || task.id, durationMs: done-start, ok: false, error: e.message });
    throw e;
  }
}

// Attach URL trigger immediately on service worker load as well
setupUrlVisitTrigger();
