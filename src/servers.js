// Pluggable calendar server registry and unified upload
// Types supported: 'radicale' (merge via ICS), 'google' (Google Calendar API)
import { DEFAULTS, isoToICSTime, escapeICSText } from './shared.js';

// ---------------- Storage ----------------
export async function loadServers() {
  const area = chrome?.storage?.local;
  const data = await area.get(['servers']);
  const list = Array.isArray(data.servers) ? data.servers : [];
  return list.map((s) => ({
    id: s.id || ('server-' + Math.random().toString(36).slice(2)),
    name: s.name || '未命名服务器',
    type: (s.type === 'radicale' || s.type === 'google') ? s.type : 'radicale',
    config: s.config || {},
  }));
}

export async function saveServers(servers) {
  const area = chrome?.storage?.local;
  const list = Array.isArray(servers) ? servers.map((s) => ({
    id: s.id || ('server-' + Math.random().toString(36).slice(2)),
    name: String(s.name || '未命名服务器'),
    type: (s.type === 'radicale' || s.type === 'google') ? s.type : 'radicale',
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

async function updateServerConfig(id, patch){
  if(!id) return null;
  const area = chrome?.storage?.local;
  const data = await area.get(['servers']);
  const list = Array.isArray(data.servers) ? data.servers : [];
  const out = list.map(s => s.id === id ? { ...s, config: { ...(s.config||{}), ...(patch||{}) } } : s);
  await area.set({ servers: out });
  return out.find(s=> s.id===id) || null;
}

// ---------------- Upload Router ----------------
export async function mergeUploadWithServer(events, calendarName, server){
  if(!server) throw new Error('服务器未配置');
  if(server.type === 'radicale'){
    return await mergeUploadWithRadicale(events, calendarName, server);
  } else if(server.type === 'google'){
    return await uploadToGoogleCalendar(events, calendarName, server);
  }
  throw new Error('不支持的服务器类型: ' + server.type);
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
    if(line === 'BEGIN:VEVENT'){ cur = { rawProps:{} }; continue; }
    if(line === 'END:VEVENT'){ if(cur){ events.push(cur); cur=null; } continue; }
    if(cur){
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

async function mergeUploadWithRadicale(events, calendarName, server){
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
  try { const res = await fetch(url, { method:'GET', headers }); if(res.ok) existingText = await res.text(); } catch(_){ }
  const existingParsed = parseExistingICS(existingText);
  const merged = mergeEvents(existingParsed, events);
  const ics = buildICS(merged, calendarName);
  const putHeaders = { 'Content-Type': 'text/calendar; charset=utf-8', ...headers };
  const put = await fetch(url, { method:'PUT', headers: putHeaders, body: ics });
  if(put.status === 200 || put.status === 201 || put.status === 204){ return { ok:true, total: merged.length, url }; }
  throw new Error('上传失败 ' + put.status);
}

// ---------------- Google Calendar Support ----------------
function toRfc3339(dt){ return (dt instanceof Date ? dt : new Date(dt)).toISOString(); }

function getMinMaxDates(arr){
  let min = null, max = null;
  for(const ev of arr){
    const s = ev.startTime instanceof Date ? ev.startTime : (ev.startTime ? new Date(ev.startTime) : null);
    const e = ev.endTime instanceof Date ? ev.endTime : (ev.endTime ? new Date(ev.endTime) : null);
    if(s && (!min || s < min)) min = s;
    if(e && (!max || e > max)) max = e;
  }
  if(!min || !max){ const now=new Date(); min=new Date(now.getTime()-7*864e5); max=new Date(now.getTime()+60*864e5); }
  // widen window a bit
  const pad1 = new Date(min.getTime() - 7*864e5);
  const pad2 = new Date(max.getTime() + 60*864e5);
  return { min: pad1, max: pad2 };
}

function normalizeGoogle(ev){
  const s = ev.startTime instanceof Date ? ev.startTime.toISOString() : (ev.startTime?.toISOString?.() || (ev.startTime ? new Date(ev.startTime).toISOString() : ''));
  const e = ev.endTime instanceof Date ? ev.endTime.toISOString() : (ev.endTime?.toISOString?.() || (ev.endTime ? new Date(ev.endTime).toISOString() : ''));
  return `${(ev.title||'').trim()}|${s}|${e}|${(ev.location||'').trim()}`.toLowerCase();
}

async function uploadToGoogleCalendar(events, calendarName, server){
  const cfg = server.config || {};
  const clientId = cfg.clientId;
  const clientSecret = cfg.clientSecret; // optional
  const calendarId = (cfg.calendarId || 'primary');
  if(!clientId) throw new Error('Google 配置缺少 Client ID');
  // Ensure access token
  const tokenInfo = await ensureGoogleAccessToken(server.id, { clientId, clientSecret, scopes: ['https://www.googleapis.com/auth/calendar'] });
  const accessToken = tokenInfo?.access_token || tokenInfo?.accessToken;
  if(!accessToken) throw new Error('未获得访问令牌');

  // Fetch existing events in time window
  const { min, max } = getMinMaxDates(events);
  const params = new URLSearchParams({ timeMin: toRfc3339(min), timeMax: toRfc3339(max), singleEvents: 'true', maxResults: '2500', orderBy: 'startTime' });
  const listUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  let listJson;
  let listRes = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if(listRes.status === 401){
    const t2 = await refreshGoogleToken(server.id, { clientId, clientSecret });
    if(!t2?.access_token && !t2?.accessToken) throw new Error('访问令牌已过期且刷新失败');
    listRes = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${t2.access_token||t2.accessToken}` } });
  }
  if(!listRes.ok) throw new Error('获取现有事件失败: ' + listRes.status);
  listJson = await listRes.json();
  const existing = Array.isArray(listJson.items) ? listJson.items : [];
  const existingMap = new Map();
  for(const it of existing){
    const start = it.start?.dateTime || (it.start?.date ? it.start.date + 'T00:00:00Z' : null);
    const end = it.end?.dateTime || (it.end?.date ? it.end.date + 'T00:00:00Z' : null);
    const sig = normalizeGoogle({ title: it.summary || '', startTime: start, endTime: end, location: it.location || '' });
    existingMap.set(sig, it);
  }
  // Compute insertions
  const toInsert = [];
  for(const ev of events){
    if(!ev.title || !ev.startTime || !ev.endTime) continue;
    const sig = normalizeGoogle(ev);
    if(existingMap.has(sig)) continue; // skip duplicates
    toInsert.push(ev);
  }
  let inserted = 0;
  for(const ev of toInsert){
    const body = {
      summary: ev.title,
      location: ev.location || undefined,
      description: ev.description ? String(ev.description) : undefined,
      start: { dateTime: toRfc3339(ev.startTime) },
      end: { dateTime: toRfc3339(ev.endTime) },
    };
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    let res = await fetch(url, { method:'POST', headers:{ 'Authorization': `Bearer ${accessToken}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if(res.status === 401){
      const t3 = await refreshGoogleToken(server.id, { clientId, clientSecret });
      res = await fetch(url, { method:'POST', headers:{ 'Authorization': `Bearer ${t3?.access_token||t3?.accessToken}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    }
    if(res.ok) inserted++; else throw new Error('插入事件失败: ' + res.status);
  }
  const total = (existing?.length || 0) + inserted;
  return { ok:true, total, inserted };
}

// ---------------- Google OAuth helpers ----------------
function base64url(arraybuffer) {
  const bytes = new Uint8Array(arraybuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(buffer){
  const enc = new TextEncoder();
  const data = enc.encode(buffer);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64url(digest);
}

function getRedirectUri(){ return `https://${chrome.runtime.id}.chromiumapp.org/`; }

async function ensureGoogleAccessToken(serverId, { clientId, clientSecret, scopes }){
  const s = await getServerById(serverId);
  const cfg = s?.config || {};
  const now = Math.floor(Date.now()/1000);
  if(cfg.token && cfg.token.access_token && cfg.token.expires_at && cfg.token.expires_at - now > 60){
    return cfg.token;
  }
  if(cfg.token && cfg.token.refresh_token){
    const t = await refreshGoogleToken(serverId, { clientId, clientSecret });
    if(t?.access_token) return t;
  }
  // need interactive auth using PKCE
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge = await sha256(codeVerifier);
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: (scopes||[]).join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const redirectResp = await new Promise((resolve, reject)=>{
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUriResp)=>{
      if(chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if(!redirectUriResp) return reject(new Error('授权失败/取消'));
      resolve(redirectUriResp);
    });
  });
  const u = new URL(redirectResp);
  const code = u.searchParams.get('code');
  if(!code) throw new Error('未获得授权码');
  const tokenParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier
  });
  if(clientSecret) tokenParams.append('client_secret', clientSecret);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: tokenParams.toString() });
  if(!tokenRes.ok) throw new Error('令牌交换失败: ' + tokenRes.status);
  const tokenJson = await tokenRes.json();
  const expires_at = Math.floor(Date.now()/1000) + (Number(tokenJson.expires_in)||3600) - 30;
  const saved = await updateServerConfig(serverId, { token: { ...tokenJson, expires_at } });
  return saved?.config?.token || { ...tokenJson, expires_at };
}

async function refreshGoogleToken(serverId, { clientId, clientSecret }){
  const s = await getServerById(serverId);
  const refresh = s?.config?.token?.refresh_token;
  if(!refresh) return null;
  const params = new URLSearchParams({ grant_type:'refresh_token', refresh_token: refresh, client_id: clientId });
  if(clientSecret) params.append('client_secret', clientSecret);
  const res = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: params.toString() });
  if(!res.ok) return null;
  const j = await res.json();
  if(!j.access_token) return null;
  const expires_at = Math.floor(Date.now()/1000) + (Number(j.expires_in)||3600) - 30;
  const newToken = { ...(s.config.token||{}), ...j, expires_at };
  await updateServerConfig(serverId, { token: newToken });
  return newToken;
}

export async function authorizeServer(serverId){
  const s = await getServerById(serverId);
  if(!s) throw new Error('服务器不存在');
  if(s.type !== 'google') throw new Error('仅 Google 服务器需要授权');
  const cfg = s.config || {};
  if(!cfg.clientId) throw new Error('请先配置 Client ID 并保存');
  await ensureGoogleAccessToken(serverId, { clientId: cfg.clientId, clientSecret: cfg.clientSecret, scopes:['https://www.googleapis.com/auth/calendar'] });
  return { ok:true };
}
