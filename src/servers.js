// Pluggable calendar server registry and unified upload
// Types supported: 'radicale' (merge via ICS), 'google' (Google Calendar API)
import { DEFAULTS, isoToICSTime, escapeICSText, loadSettings } from './shared.js';

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
  // Prefer merged settings (DEFAULTS + config/dev.json + saved) for Google settings
  const settings = await loadSettings();
  const nowSec = Math.floor(Date.now()/1000);
  let accessToken = null;
  if(cfg.token?.access_token && cfg.token.expires_at && cfg.token.expires_at - nowSec > 60){
    accessToken = cfg.token.access_token;
  }
  const clientId = cfg.clientId || settings.googleClientId || DEFAULTS.googleClientId;
  const clientSecret = cfg.clientSecret; // optional
  const fallbackCalendarId = (cfg.calendarId || settings.googleCalendarId || DEFAULTS.googleCalendarId || 'primary');
  // Try Chrome Identity first (no client_secret required). Requires manifest.oauth2 configured.
  const manifest = (chrome?.runtime?.getManifest?.() || {});
  const hasManifestOauth = !!(manifest.oauth2 && manifest.oauth2.client_id);
  const usingIdentityMode = cfg.oauthMode === 'identity';
  async function persistIdentityToken(token, lifetimeSec = 3600){
    if(!token) return null;
    const expires_at = Math.floor(Date.now()/1000) + lifetimeSec - 30;
    const saved = await updateServerConfig(server.id, { token: { access_token: token, token_type:'Bearer', expires_at, source:'identity' }, oauthMode:'identity' });
    cfg.token = saved?.config?.token || { access_token: token, token_type:'Bearer', expires_at, source:'identity' };
    return cfg.token;
  }
  if(!accessToken && usingIdentityMode && chrome?.identity?.getAuthToken){
    let tok = null;
    try { tok = await getTokenViaChromeIdentity({ interactive: false }); }
    catch(_){ tok = await getTokenViaChromeIdentity({ interactive: true }); }
    if(!tok) throw new Error('未获得访问令牌');
    const stored = await persistIdentityToken(tok);
    accessToken = stored?.access_token || tok;
  }
  if(hasManifestOauth && chrome?.identity?.getAuthToken){
    if(!accessToken){
      // Try silent first to avoid prompting every time
      try {
        const tok = await getTokenViaChromeIdentity({ interactive: false });
        if(tok){
          const stored = await persistIdentityToken(tok);
          accessToken = stored?.access_token || tok;
        }
      } catch(_){ /* fall back */ }
    }
  }
  if(!accessToken){
    if(!clientId) throw new Error('Google 配置缺少 Client ID');
    const tokenInfo = await ensureGoogleAccessToken(server.id, { clientId, clientSecret, scopes: ['https://www.googleapis.com/auth/calendar'] });
    accessToken = tokenInfo?.access_token || tokenInfo?.accessToken;
    if(tokenInfo?.source === 'identity' && tokenInfo?.access_token){
      cfg.token = tokenInfo;
    }
  }
  if(!accessToken && hasManifestOauth && chrome?.identity?.getAuthToken){
    // Last resort: interactive identity prompt (once). Avoid double prompt by not chaining multiple flows in one run
    try {
      const tok = await getTokenViaChromeIdentity({ interactive: true });
      if(tok){
        const stored = await persistIdentityToken(tok);
        accessToken = stored?.access_token || tok;
      }
    } catch(_){ /* keep null */ }
  }
  if(!accessToken) throw new Error('未获得访问令牌');

  // Resolve target calendar id: prefer task's calendarName (summary). If missing/failed, fallback to configured id.
  async function resolveCalendarId(){
    const name = (calendarName||'').trim();
    // Use cached mapping if available
    if(name && cfg.calendarMap && cfg.calendarMap[name]) return cfg.calendarMap[name];
    if(!name){ return fallbackCalendarId || 'primary'; }
    // List calendars and search by summary
    try {
      let pageToken = undefined;
      let found = null;
      do {
        const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
        url.searchParams.set('maxResults','250');
        if(pageToken) url.searchParams.set('pageToken', pageToken);
        const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if(!res.ok) break;
        const j = await res.json();
        const items = Array.isArray(j.items)? j.items: [];
        found = items.find(it => (it.summary||'') === name) || null;
        pageToken = j.nextPageToken || null;
      } while(!found && pageToken);
      if(found && found.id){
        // cache mapping
        const newMap = { ...(cfg.calendarMap||{}), [name]: found.id };
        await updateServerConfig(server.id, { calendarMap: newMap });
        cfg.calendarMap = newMap; // update local copy
        return found.id;
      }
    } catch(_){ /* fall through to create */ }
    // Not found: create new calendar
    try{
      const body = { summary: name };
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if(!res.ok){
        let detail = '';
        try{ detail = (await res.text())?.slice(0,300) || ''; } catch(_){ }
        // fallback: use configured id if creation fails
        throw new Error('创建日历失败: ' + res.status + (detail? (' '+detail):''));
      }
      const j = await res.json();
      if(j && j.id){
        const newMap = { ...(cfg.calendarMap||{}), [name]: j.id };
        await updateServerConfig(server.id, { calendarMap: newMap });
        cfg.calendarMap = newMap;
        return j.id;
      }
    } catch(e){ /* creation failed -> fallback */ }
    return fallbackCalendarId || 'primary';
  }

  const calendarId = await resolveCalendarId();
  // Fetch existing events in time window
  const { min, max } = getMinMaxDates(events);
  const params = new URLSearchParams({ timeMin: toRfc3339(min), timeMax: toRfc3339(max), singleEvents: 'true', maxResults: '2500', orderBy: 'startTime' });
  const listUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  let listJson;
  let listRes;
  try {
    listRes = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  } catch(e){
    throw new Error('获取 Google 日历事件失败: ' + (e?.message||e));
  }
  if(listRes.status === 401){
    // Try identity refresh path first (single retry only)
    if(hasManifestOauth && chrome?.identity?.getAuthToken){
      try {
        const refreshed = await refreshChromeIdentityToken(accessToken);
        if(refreshed){
          const stored = await persistIdentityToken(refreshed);
          accessToken = stored?.access_token || refreshed;
        }
        listRes = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      } catch(e){ /* fallback below */ }
    }
    if(!listRes || listRes.status === 401){
      const t2 = await refreshGoogleToken(server.id, { clientId, clientSecret });
      if(!t2?.access_token && !t2?.accessToken) throw new Error('访问令牌已过期且刷新失败');
      try {
        listRes = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${t2.access_token||t2.accessToken}` } });
      } catch(e){
        throw new Error('获取 Google 日历事件失败(重试): ' + (e?.message||e));
      }
    }
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
    let res;
    try {
      res = await fetch(url, { method:'POST', headers:{ 'Authorization': `Bearer ${accessToken}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    } catch(e){
      throw new Error('创建事件失败: ' + (e?.message||e));
    }
    if(res.status === 401){
      // identity refresh first (single retry only)
      if(hasManifestOauth && chrome?.identity?.getAuthToken){
        try {
          const refreshed = await refreshChromeIdentityToken(accessToken);
          if(refreshed){
            const stored = await persistIdentityToken(refreshed);
            accessToken = stored?.access_token || refreshed;
          }
          res = await fetch(url, { method:'POST', headers:{ 'Authorization': `Bearer ${accessToken}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
        } catch(_){ /* fallback */ }
      }
      if(!res || res.status === 401){
        const t3 = await refreshGoogleToken(server.id, { clientId, clientSecret });
        try {
          res = await fetch(url, { method:'POST', headers:{ 'Authorization': `Bearer ${t3?.access_token||t3?.accessToken}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
        } catch(e){
          throw new Error('创建事件失败(重试): ' + (e?.message||e));
        }
      }
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
  if(cfg.oauthMode === 'identity'){
    let tok;
    try { tok = await getTokenViaChromeIdentity({ interactive: false }); }
    catch(_){ tok = await getTokenViaChromeIdentity({ interactive: true }); }
    if(!tok) throw new Error('未获得授权令牌');
    const expires_at = Math.floor(Date.now()/1000) + 3300;
    const saved = await updateServerConfig(serverId, { token: { access_token: tok, token_type:'Bearer', expires_at, source:'identity' }, oauthMode: 'identity' });
    return saved?.config?.token || { access_token: tok, token_type:'Bearer', expires_at, source:'identity' };
  }
  let mode = cfg.oauthMode;
  if(!mode){
    if(cfg.token?.refresh_token){
      mode = 'pkce';
    } else if(clientSecret){
      mode = 'pkce';
    } else {
      mode = 'implicit';
    }
  }
  if(mode === 'implicit'){
    const implicit = await getAccessTokenViaImplicit({ clientId, scopes: (scopes||[]) });
    if(!implicit?.access_token) throw new Error('未获得授权令牌');
    const expires_at = Math.floor(Date.now()/1000) + (Number(implicit.expires_in)||3600) - 30;
    const saved2 = await updateServerConfig(serverId, { token: { access_token: implicit.access_token, token_type: 'Bearer', expires_in: implicit.expires_in, expires_at }, oauthMode: 'implicit' });
    return saved2?.config?.token || { access_token: implicit.access_token, token_type: 'Bearer', expires_in: implicit.expires_in, expires_at };
  }
  // need interactive auth using PKCE (installed-app friendly). May fail if client_id belongs to Web app requiring client_secret.
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
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
    code_challenge_method: 'S256',
    state
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
  const retState = u.searchParams.get('state');
  if(retState && retState !== state) throw new Error('授权状态校验失败');
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
  let tokenRes;
  try {
    tokenRes = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: tokenParams.toString() });
  } catch(e){
    throw new Error('令牌交换请求失败: ' + (e?.message||e));
  }
  if(!tokenRes.ok){
    let detail = '';
    try { const t = await tokenRes.text(); detail = t?.slice(0,300) || ''; } catch(_){ }
    // If server insists on client_secret (confidential client), try implicit flow (no refresh_token)
    if(tokenRes.status === 400 && /client[_-]?secret|secret key|missing\s+secret/i.test(detail || '')){
      await updateServerConfig(serverId, { oauthMode: 'implicit' });
      throw new Error('当前 Client ID 需要 Client Secret，已切换为隐式授权模式，请重新点击一次“授权”。');
    }
    throw new Error('令牌交换失败: '+ tokenRes.status + (detail? (' '+detail):''));
  }
  const tokenJson = await tokenRes.json();
  const expires_at = Math.floor(Date.now()/1000) + (Number(tokenJson.expires_in)||3600) - 30;
  const saved = await updateServerConfig(serverId, { token: { ...tokenJson, expires_at }, oauthMode: 'pkce' });
  return saved?.config?.token || { ...tokenJson, expires_at };
}

async function refreshGoogleToken(serverId, { clientId, clientSecret }){
  const s = await getServerById(serverId);
  const refresh = s?.config?.token?.refresh_token;
  if(!refresh) return null;
  const params = new URLSearchParams({ grant_type:'refresh_token', refresh_token: refresh, client_id: clientId });
  if(clientSecret) params.append('client_secret', clientSecret);
  let res;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: params.toString() });
  } catch(_){
    return null;
  }
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
  // If manifest oauth2 is configured, try identity flow which doesn't require clientId here
  const manifest = (chrome?.runtime?.getManifest?.() || {});
  const hasManifestOauth = !!(manifest.oauth2 && manifest.oauth2.client_id);
  if(hasManifestOauth && chrome?.identity?.getAuthToken){
    let token;
    try { token = await getTokenViaChromeIdentity({ interactive: false }); }
    catch(_){ token = await getTokenViaChromeIdentity({ interactive: true }); }
    if(!token) throw new Error('未获得浏览器身份令牌');
    const expires_at = Math.floor(Date.now()/1000) + 3300;
    await updateServerConfig(serverId, { token: { access_token: token, token_type: 'Bearer', expires_at, source:'identity' }, oauthMode: 'identity' });
    return { ok:true };
  }
  // Use packaged/default clientId when not provided in server config
  const settings = await loadSettings();
  const clientId = cfg.clientId || settings.googleClientId || DEFAULTS.googleClientId;
  const clientSecret = cfg.clientSecret; // optional
  if(!clientId) throw new Error('缺少 Google Client ID：请在 config/dev.json 或 DEFAULTS 中配置');
  // Avoid re-prompt: if we already have a valid (not expired) token, return early
  const now = Math.floor(Date.now()/1000);
  if(cfg.token && cfg.token.access_token && cfg.token.expires_at && cfg.token.expires_at - now > 60){
    return { ok:true };
  }
  await ensureGoogleAccessToken(serverId, { clientId, clientSecret, scopes:['https://www.googleapis.com/auth/calendar'] });
  return { ok:true };
}

// ---------------- Chrome Identity token helpers ----------------
async function getTokenViaChromeIdentity(opts={}){
  const interactive = !!opts.interactive;
  return new Promise((resolve, reject)=>{
    try {
      chrome.identity.getAuthToken({ interactive }, (token)=>{
        if(chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if(!token) return reject(new Error('未获得浏览器身份令牌'));
        resolve(token);
      });
    } catch(e){ reject(e); }
  });
}

async function refreshChromeIdentityToken(prevToken){
  // Remove cached token then re-acquire silently, fallback to interactive
  if(prevToken){
    try { await new Promise((resolve)=> chrome.identity.removeCachedAuthToken({ token: prevToken }, ()=> resolve())); } catch(_){ }
  }
  return new Promise((resolve, reject)=>{
    try {
      chrome.identity.getAuthToken({ interactive: false }, (token)=>{
        if(chrome.runtime.lastError || !token){
          // final attempt interactive
          chrome.identity.getAuthToken({ interactive: true }, (tok2)=>{
            if(chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if(!tok2) return reject(new Error('未获得浏览器身份令牌'));
            resolve(tok2);
          });
          return;
        }
        resolve(token);
      });
    } catch(e){ reject(e); }
  });
}

// Implicit grant (response_type=token) fallback for public clients (no refresh_token)
async function getAccessTokenViaImplicit({ clientId, scopes }){
  try{
    const redirectUri = getRedirectUri();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: (scopes||[]).join(' '),
      include_granted_scopes: 'true',
      prompt: 'consent'
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
    const frag = u.hash || '';
    const sp = new URLSearchParams(frag.startsWith('#')? frag.slice(1) : frag);
    const access_token = sp.get('access_token');
    const expires_in = sp.get('expires_in');
    if(!access_token) return null;
    return { access_token, expires_in: expires_in ? Number(expires_in) : undefined };
  } catch(e){ return null; }
}
