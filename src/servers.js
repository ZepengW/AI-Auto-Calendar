// Pluggable calendar server registry and unified upload
// Types supported: 'radicale' (merge via ICS)
import { DEFAULTS, isoToICSTime, escapeICSText } from './shared.js';

// ---------------- Storage ----------------
export async function loadServers() {
  const area = chrome?.storage?.local;
  const data = await area.get(['servers']);
  const list = Array.isArray(data.servers) ? data.servers : [];
  return list.map((s) => ({
    id: s.id || ('server-' + Math.random().toString(36).slice(2)),
    name: s.name || '未命名服务器',
    type: s.type === 'radicale' ? 'radicale' : 'radicale',
    config: s.config || {},
  }));
}

export async function saveServers(servers) {
  const area = chrome?.storage?.local;
  const list = Array.isArray(servers) ? servers.map((s) => ({
    id: s.id || ('server-' + Math.random().toString(36).slice(2)),
    name: String(s.name || '未命名服务器'),
    type: s.type === 'radicale' ? 'radicale' : 'radicale',
    config: typeof s.config === 'object' && s.config ? s.config : {},
  })) : [];
  await area.set({ servers: list });
  return list;
}

export async function getServerById(id) {
  if (!id) return null;
  const list = await loadServers();
  return list.find((s) => s.id === id) || null;
}

// ---------------- Upload (Radicale) ----------------
function parseICSTime(val){
  if(!val) return null;
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
        const keyPart = line.slice(0, idx);
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
  const s = ev.startTime instanceof Date ? ev.startTime.toISOString() : (ev.startTime?.toISOString?.()||'');
  const e = ev.endTime instanceof Date ? ev.endTime.toISOString() : (ev.endTime?.toISOString?.()||'');
  return `${(ev.title||'').trim()}|${s}|${e}|${(ev.location||'').trim()}`.toLowerCase();
}

function mergeEvents(existing, incoming){
  const map = new Map();
  for(const ev of existing){ map.set(normalizeForMerge(ev), ev); }
  for(const ev of incoming){
    const sig = normalizeForMerge(ev);
    if(map.has(sig)){
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

function buildICS(events, calendarName = 'Calendar'){
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SJTU-Auto-Calendar//EN',
    `X-WR-CALNAME:${escapeICSText(calendarName)}`,
    'X-WR-TIMEZONE:UTC',
  ];
  for(const ev of events){
    try{
      if(!ev.startTime || !ev.endTime || !ev.title) continue;
      lines.push('BEGIN:VEVENT');
      const uid = ev.eventId || ev.id || 'evt-' + Math.random().toString(36).slice(2);
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${isoToICSTime(now)}`);
      const s = ev.startTime instanceof Date ? ev.startTime : null;
      const e = ev.endTime instanceof Date ? ev.endTime : null;
      if(!s || !e) continue;
      lines.push(`DTSTART:${isoToICSTime(s)}`);
      lines.push(`DTEND:${isoToICSTime(e)}`);
      lines.push(`SUMMARY:${escapeICSText(ev.title || ev.summary || '')}`);
  if (ev.location) lines.push(`LOCATION:${escapeICSText(ev.location)}`);
  if (ev.status) lines.push(`STATUS:${escapeICSText(ev.status)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeICSText(String(ev.description))}`);
      lines.push('END:VEVENT');
    }catch(e){ /* ignore one event */ }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function buildOriginFromUrl(raw){
  try { const u = new URL(raw); return `${u.protocol}//${u.hostname}${u.port?':'+u.port:''}/*`; } catch(_){ return null; }
}

export async function mergeUploadWithServer(events, calendarName, server){
  if(!server || server.type !== 'radicale') throw new Error('不支持的服务器类型');
  const cfg = server.config || {};
  const base = String(cfg.base || DEFAULTS.radicalBase || '').replace(/\/$/, '');
  const user = cfg.username || DEFAULTS.radicalUsername;
  const auth = cfg.auth || DEFAULTS.radicalAuth || '';
  if(!base || !user) throw new Error('服务器配置不完整');
  const url = `${base}/${encodeURIComponent(user)}/${encodeURIComponent(calendarName)}.ics`;
  const headers = {};
  if(auth) headers['Authorization'] = auth;

  // permissions
  const originPattern = buildOriginFromUrl(base);
  if(originPattern && chrome.permissions){
    const ok = await new Promise((resolve)=>{
      chrome.permissions.contains({ origins:[originPattern] }, (has)=> resolve(!!has));
    });
    if(!ok){ throw new Error('缺少服务器权限: ' + originPattern); }
  }

  // GET existing
  let existingText = '';
  try { const res = await fetch(url, { method:'GET', headers }); if(res.ok) existingText = await res.text(); } catch(_){}
  const existingParsed = parseExistingICS(existingText);
  const merged = mergeEvents(existingParsed, events);
  const ics = buildICS(merged, calendarName);
  const putHeaders = { 'Content-Type': 'text/calendar; charset=utf-8', ...headers };
  const put = await fetch(url, { method:'PUT', headers: putHeaders, body: ics });
  if(put.status === 200 || put.status === 201 || put.status === 204){ return { ok:true, total: merged.length, url }; }
  throw new Error('上传失败 ' + put.status);
}
