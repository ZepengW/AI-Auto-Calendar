// Pluggable calendar server registry and unified upload
// Types supported: 'radicale' (merge via ICS), 'google' (Google Calendar API)
import { DEFAULTS, isoToICSTime, escapeICSText, loadSettings, expandRecurringEvents } from './shared.js';

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
export async function mergeUploadWithServer(events, calendarName, server, meta = {}){
  if(!server) throw new Error('服务器未配置');
  if(server.type === 'radicale'){
    return await mergeUploadWithRadicale(events, calendarName, server, meta);
  } else if(server.type === 'google'){
    return await uploadToGoogleCalendar(events, calendarName, server, meta);
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
    if(line === 'BEGIN:VEVENT'){
      cur = { rawProps:{}, rawLines:[raw] };
      continue;
    }
    // If inside a VEVENT and we encounter BEGIN:VALARM, enter alarm passthrough mode so VALARM DESCRIPTION does not overwrite event description
    if(cur && /^BEGIN:VALARM/i.test(line)){
      cur.rawLines.push(raw);
      cur.inAlarm = true;
      continue;
    }
    if(cur && cur.inAlarm){
      cur.rawLines.push(raw);
      if(/^END:VALARM/i.test(line)) cur.inAlarm = false;
      continue;
    }
    if(line === 'END:VEVENT'){
      if(cur){
        cur.rawLines.push(raw);
        cur.rawICS = cur.rawLines.join('\n');
        delete cur.rawLines;
        delete cur.inAlarm;
        events.push(cur);
      }
      cur=null;
      continue;
    }
    if(cur){
      cur.rawLines.push(raw);
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
        if(key === 'RRULE') cur.rrule = value;
      }
    }
  }
  // Post-process: extract VALARM triggers into alarms array (minutesBefore)
  for(const ev of events){
    if(ev && typeof ev.rawICS === 'string' && /BEGIN:VALARM/i.test(ev.rawICS) && !Array.isArray(ev.alarms)){
      // Parse individual VALARM blocks preserving DESCRIPTION (use 'Reminder' fallback)
      const blocks = ev.rawICS.split(/BEGIN:VALARM/i).slice(1).map(b=> 'BEGIN:VALARM'+b);
      const out = [];
      for(const block of blocks){
        const endIdx = block.search(/END:VALARM/i);
        const seg = endIdx>=0 ? block.slice(0, endIdx+10) : block; // include END:VALARM
        const trig = seg.match(/TRIGGER:-PT(\d+)([HM])/i);
        if(!trig) continue; let mins = Number(trig[1]); const unit = trig[2].toUpperCase(); if(unit==='H') mins *= 60;
        if(!Number.isFinite(mins) || mins<=0) continue;
        const descMatch = seg.match(/DESCRIPTION:(.*)/i);
        let desc = descMatch ? descMatch[1].trim() : 'Reminder';
        // Unfold potential line continuations (ICS uses CRLF + space) - simple replacement
        desc = desc.replace(/\r?\n[ \t]/g,'');
        out.push({ minutesBefore: mins, description: desc||'Reminder' });
      }
      if(out.length){
        // Deduplicate by minutesBefore keeping first description
        const uniq = [];
        const seen = new Set();
        for(const a of out.sort((x,y)=> x.minutesBefore - y.minutesBefore)){
          if(seen.has(a.minutesBefore)) continue;
          seen.add(a.minutesBefore);
          uniq.push(a);
        }
        ev.alarms = uniq;
      }
    }
    // If event.description exists but only comes from VALARM (i.e., no DESCRIPTION outside alarm blocks), clear it
    if(ev && typeof ev.rawICS === 'string' && ev.description){
      const raw = ev.rawICS;
      const hasEventDesc = /\nDESCRIPTION:/i.test('\n'+raw.replace(/BEGIN:VALARM[\s\S]*?END:VALARM/ig,''));
      if(!hasEventDesc && /^Reminder$/i.test(ev.description.trim())){
        delete ev.description;
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

function toIcsDateString(raw, dateObj){
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d{8}$/.test(trimmed)) return trimmed;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.replace(/-/g, '');
  }
  if (dateObj instanceof Date && !isNaN(dateObj)) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
  return '';
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
    try {
      if(!ev.startTime || !ev.endTime || !ev.title) continue;
      const raw = typeof ev.rawICS === 'string' ? ev.rawICS.trim() : '';
      if(raw && raw.toUpperCase().includes('BEGIN:VEVENT')){
        if(/BEGIN:VALARM/i.test(raw) || !Array.isArray(ev.alarms) || !ev.alarms.length){
          const blockLines = raw.replace(/\r?\n/g,'\r\n').split(/\r?\n/);
          lines.push(...blockLines);
          continue;
        } else {
          // inject alarms before END:VEVENT
          const srcLines = raw.replace(/\r?\n/g,'\n').split(/\n/);
            const out = [];
            for(const l of srcLines){
              if(l.trim().toUpperCase()==='END:VEVENT'){
                for(const al of ev.alarms){
                  const mins = Number(al.minutesBefore);
                  if(!Number.isFinite(mins) || mins<=0) continue;
                  out.push('BEGIN:VALARM');
                  out.push(`TRIGGER:-PT${Math.floor(mins)}M`);
                  out.push('ACTION:DISPLAY');
                  out.push(`DESCRIPTION:${escapeICSText(al.description||'Reminder')}`);
                  out.push('END:VALARM');
                }
              }
              out.push(l);
            }
            lines.push(...out);
            continue;
        }
      }
      lines.push('BEGIN:VEVENT');
      const uid = ev.uid || ev.eventId || ev.id || 'evt-' + Math.random().toString(36).slice(2);
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${isoToICSTime(now)}`);
      const sDate = ev.startTime instanceof Date ? ev.startTime : null;
      const eDate = ev.endTime instanceof Date ? ev.endTime : null;
      if(!sDate || !eDate){ lines.push('END:VEVENT'); continue; }
      const startIsDate = !!(ev.startTimeIsDate || ev.startIsDate || ev.allDay);
      const endIsDate = !!(ev.endTimeIsDate || ev.endIsDate || ev.allDay);
      if(startIsDate){
        const dateStr = toIcsDateString(ev.startDateText, sDate);
        if(dateStr) lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
      } else {
        lines.push(`DTSTART:${isoToICSTime(sDate)}`);
      }
      if(endIsDate){
        const dateStr = toIcsDateString(ev.endDateText, eDate);
        if(dateStr) lines.push(`DTEND;VALUE=DATE:${dateStr}`);
      } else {
        lines.push(`DTEND:${isoToICSTime(eDate)}`);
      }
      lines.push(`SUMMARY:${escapeICSText(ev.title || ev.summary || '')}`);
      if(ev.location) lines.push(`LOCATION:${escapeICSText(ev.location)}`);
      if(ev.status) lines.push(`STATUS:${escapeICSText(ev.status)}`);
      if(ev.rrule){
        const clause = String(ev.rrule).trim();
        if(clause){
          lines.push(clause.toUpperCase().startsWith('RRULE:') ? clause : `RRULE:${clause}`);
        }
      }
      if(ev.description) lines.push(`DESCRIPTION:${escapeICSText(String(ev.description))}`);
      // Inject VALARM blocks if alarms present (and not already handled above by rawICS injection)
      if(Array.isArray(ev.alarms) && ev.alarms.length){
        const added = new Set();
        for(const al of ev.alarms){
          const mins = Number(al.minutesBefore);
          if(!Number.isFinite(mins) || mins<=0) continue;
          const key = Math.floor(mins);
          if(added.has(key)) continue; // avoid duplicates
          added.add(key);
          lines.push('BEGIN:VALARM');
          lines.push(`TRIGGER:-PT${key}M`);
          lines.push('ACTION:DISPLAY');
          lines.push(`DESCRIPTION:${escapeICSText(al.description||'Reminder')}`);
          lines.push('END:VALARM');
        }
      }
      lines.push('END:VEVENT');
    } catch(e){ /* ignore one event */ }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
// Core Radicale merge + upload with stats (insert/update/skip/delete + optional coverage deletion)
async function mergeUploadWithRadicale(events, calendarName, server, meta = {}){
  const cfg = server?.config || {};
  // Lazy load settings for debug flag (avoid circular import at top-level to keep tree-shake simple)
  let settings = null;
  try { settings = await loadSettings(); } catch(_) { settings = { debugServerDiff:true }; }
  const debugDiff = !!settings.debugServerDiff;
  const baseRaw = (cfg.base || '').trim();
  if(!baseRaw) throw new Error('未配置 Radicale 基础地址');
  const base = baseRaw.replace(/\/$/, '');
  const user = (cfg.username || 'calendar').trim();
  const auth = (cfg.auth || '').trim();
  const url = `${base}/${encodeURIComponent(user)}/${encodeURIComponent(calendarName||'Calendar')}.ics`;
  const headers = { };
  if(auth) headers['Authorization'] = auth;
  let existingText = '';
  try {
    const res = await fetch(url, { method:'GET', headers });
    if(res.ok){ existingText = await res.text(); }
  } catch(_){ /* treat as empty */ }
  const existing = parseExistingICS(existingText);
  // Build lookup maps
  const existingByUid = new Map();
  const existingByDayTitle = new Map();
  const existingBySignature = new Map();
  function dayTitleKey(ev){
    if(!ev || !ev.startTime || !ev.title) return '';
    const d = ev.startTime instanceof Date ? ev.startTime : new Date(ev.startTime);
    if(!(d instanceof Date) || isNaN(d)) return '';
    const datePart = d.toISOString().slice(0,10);
    return `${(ev.title||'').trim().toLowerCase()}|${datePart}`;
  }
  for(const ev of existing){
    if(ev.uid){ existingByUid.set(ev.uid.trim().toLowerCase(), ev); }
    const k = dayTitleKey(ev); if(k && !existingByDayTitle.has(k)) existingByDayTitle.set(k, ev);
    const sig = normalizeForMerge(ev); if(sig && !existingBySignature.has(sig)) existingBySignature.set(sig, ev);
  }
  // Helpers for logical equality (decide skip vs update)
  function sameLogical(a,b){
    if(!a || !b) return false;
    const f = (v)=> (v||'').trim();
    const iso = (dt)=> (dt instanceof Date && !isNaN(dt)) ? dt.toISOString() : (dt? new Date(dt).toISOString(): '');
    const rrA = (a.rrule||'').trim().toUpperCase();
    const rrB = (b.rrule||'').trim().toUpperCase();
    // Normalize alarms for comparison (minutesBefore ascending). Existing (a) may only have rawICS VALARM lines.
    function normAlarmsFromRaw(ev){
      const out = [];
      if(ev && typeof ev.rawICS === 'string'){
        const blocks = ev.rawICS.split(/BEGIN:VALARM/i).slice(1).map(b=> 'BEGIN:VALARM'+b);
        for(const block of blocks){
          const trig = block.match(/TRIGGER:-PT(\d+)([HM])/i);
            if(trig){ let mins = Number(trig[1]); const unit = trig[2].toUpperCase(); if(unit==='H') mins *= 60; if(Number.isFinite(mins) && mins>0) out.push(mins); }
        }
      }
      if(Array.isArray(ev?.alarms)){
        for(const al of ev.alarms){ const mins = Number(al.minutesBefore); if(Number.isFinite(mins) && mins>0) out.push(mins); }
      }
      return out.sort((x,y)=>x-y);
    }
    const alarmsA = normAlarmsFromRaw(a);
    const alarmsB = normAlarmsFromRaw(b);
    const sameAlarms = alarmsA.length === alarmsB.length && alarmsA.every((v,i)=> v===alarmsB[i]);
    // Treat placeholder description 'Reminder' as empty (server may drop it)
    const descA = (f(a.description)==='Reminder') ? '' : f(a.description);
    const descB = (f(b.description)==='Reminder') ? '' : f(b.description);
    return f(a.title) === f(b.title)
      && f(a.location) === f(b.location)
      && iso(a.startTime) === iso(b.startTime)
      && iso(a.endTime) === iso(b.endTime)
      && rrA === rrB
      && descA === descB
      && sameAlarms;
  }
  const usedExisting = new Set();
  const replacedExisting = new Map(); // existing event -> new event
  const inserts = [];
  let inserted=0, updated=0, skipped=0;
  const incomingUidSet = new Set();
  const incomingSignatureSet = new Set();
  for(const ev of (events||[])){
    if(!ev || !ev.title || !ev.startTime || !ev.endTime){ continue; }
    const uidLower = (ev.uid || ev.id || '').trim().toLowerCase();
    if(uidLower) incomingUidSet.add(uidLower);
    const sig = normalizeForMerge(ev); if(sig) incomingSignatureSet.add(sig);
    let matched = null; let matchType = '';
    if(uidLower && existingByUid.has(uidLower)){ matched = existingByUid.get(uidLower); matchType='uid'; }
    else {
      const k = dayTitleKey(ev); if(k && existingByDayTitle.has(k)){ matched = existingByDayTitle.get(k); matchType='dayTitle'; }
      else if(existingBySignature.has(sig)){ matched = existingBySignature.get(sig); matchType='signature'; }
    }
    if(matched){
      if(sameLogical(matched, ev)){
        skipped++; usedExisting.add(matched); continue;
      }
      // Update: preserve UID
      const newEv = { ...matched, ...ev };
      if(newEv.rawICS) delete newEv.rawICS;
      if(matched.uid && !newEv.uid) newEv.uid = matched.uid;
      if(debugDiff){
        const diffs = [];
        const cmpList = [
          ['title', matched.title, ev.title],
          ['startTime', matched.startTime, ev.startTime],
          ['endTime', matched.endTime, ev.endTime],
          ['location', matched.location, ev.location],
          ['description', matched.description, ev.description],
          ['rrule', matched.rrule, ev.rrule],
        ];
        function normAlarmsForCmp(x){
          function extract(arr){ return arr.map(a=>Number(a.minutesBefore)).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b); }
          if(Array.isArray(x?.alarms)) return extract(x.alarms).join(',');
          if(typeof x?.rawICS === 'string' && /BEGIN:VALARM/i.test(x.rawICS)){
            const blocks = x.rawICS.split(/BEGIN:VALARM/i).slice(1).map(b=>'BEGIN:VALARM'+b);
            const ms=[]; for(const bl of blocks){ const m=bl.match(/TRIGGER:-PT(\d+)([HM])/i); if(m){ let v=Number(m[1]); if(m[2].toUpperCase()==='H') v*=60; if(Number.isFinite(v)) ms.push(v); } }
            return ms.sort((a,b)=>a-b).join(',');
          }
          return '';
        }
        const alarmsOld = normAlarmsForCmp(matched);
        const alarmsNew = normAlarmsForCmp(ev);
        if(alarmsOld !== alarmsNew) diffs.push({ field:'alarms', from:alarmsOld, to:alarmsNew });
        for(const [field, aVal, bVal] of cmpList){
          const aStr = aVal instanceof Date ? aVal.toISOString() : (aVal||'');
          const bStr = bVal instanceof Date ? bVal.toISOString() : (bVal||'');
          if(aStr !== bStr){ diffs.push({ field, from:aStr, to:bStr }); }
        }
        if(diffs.length){
          console.log('[Radicale-DIFF]', calendarName, 'UID=', matched.uid||matched.id, diffs);
        }
      }
      replacedExisting.set(matched, newEv);
      usedExisting.add(matched);
      updated++;
    } else {
      // New insert: ensure uid
      if(!ev.uid) ev.uid = ev.id || 'evt-' + Math.random().toString(36).slice(2);
      inserts.push(ev); inserted++;
    }
  }
  // Coverage deletion: events in window not matched by any incoming (by uid/signature)
  let deleted = 0;
  const toDeleteSet = new Set();
  if(meta?.coverage){
    // Determine window
    const winStart = meta.windowStart instanceof Date ? meta.windowStart : null;
    const winEnd = meta.windowEnd instanceof Date ? meta.windowEnd : null;
    for(const ex of existing){
      if(usedExisting.has(ex)) continue; // already kept implicitly
      if(ex.uid && incomingUidSet.has(ex.uid.trim().toLowerCase())){ usedExisting.add(ex); continue; }
      const sig = normalizeForMerge(ex); if(sig && incomingSignatureSet.has(sig)){ usedExisting.add(ex); continue; }
      if(winStart && winEnd && ex.startTime instanceof Date){
        const t = ex.startTime.getTime();
        if(t >= winStart.getTime() && t <= winEnd.getTime()){
          toDeleteSet.add(ex); deleted++; continue;
        }
      }
    }
  }
  // Build final list
  const finalEvents = [];
  for(const ex of existing){
    if(toDeleteSet.has(ex)) continue; // deleted
    if(replacedExisting.has(ex)){ finalEvents.push(replacedExisting.get(ex)); continue; }
    finalEvents.push(ex); // untouched or skipped
  }
  for(const ins of inserts){ finalEvents.push(ins); }
  // Detect no-op semantic update (all updated events produce identical fingerprints to existing)
  function fingerprint(ev){
    const iso = (dt)=> (dt instanceof Date && !isNaN(dt)) ? dt.toISOString() : (dt? new Date(dt).toISOString(): '');
    const alarms = Array.isArray(ev.alarms)? ev.alarms.map(a=> Number(a.minutesBefore)).filter(m=>Number.isFinite(m)&&m>0).sort((a,b)=>a-b).join(',') : '';
    return [ (ev.title||'').trim(), iso(ev.startTime), iso(ev.endTime), (ev.location||'').trim(), (ev.description||'').trim(), (ev.rrule||'').trim().toUpperCase(), alarms ].join('|');
  }
  // Extract alarms from raw existing if not already in object
  function enrichExistingAlarms(ev){
    if(Array.isArray(ev.alarms)) return ev;
    if(ev && typeof ev.rawICS === 'string' && /BEGIN:VALARM/i.test(ev.rawICS)){
      const blocks = ev.rawICS.split(/BEGIN:VALARM/i).slice(1).map(b=> 'BEGIN:VALARM'+b);
      const temp = [];
      for(const block of blocks){
        const trig = block.match(/TRIGGER:-PT(\d+)([HM])/i);
        if(!trig) continue; let mins = Number(trig[1]); const unit = trig[2].toUpperCase(); if(unit==='H') mins *= 60;
        if(!Number.isFinite(mins) || mins<=0) continue;
        const descMatch = block.match(/DESCRIPTION:(.*)/i);
        let desc = descMatch ? descMatch[1].trim() : 'Reminder';
        desc = desc.replace(/\r?\n[ \t]/g,'');
        temp.push({ minutesBefore: mins, description: desc||'Reminder' });
      }
      if(temp.length){
        const uniq=[]; const seen=new Set();
        for(const a of temp.sort((x,y)=> x.minutesBefore - y.minutesBefore)){
          if(seen.has(a.minutesBefore)) continue; seen.add(a.minutesBefore); uniq.push(a);
        }
        ev.alarms = uniq;
      }
    }
    return ev;
  }
  if(inserted===0 && deleted===0 && updated>0){
    let allSame = true;
    for(const ex of existing){
      if(toDeleteSet.has(ex)) continue; // deleted would break preconditions but keep safe
      const current = replacedExisting.has(ex)? replacedExisting.get(ex) : ex;
      enrichExistingAlarms(ex);
      enrichExistingAlarms(current);
      if(fingerprint(ex) !== fingerprint(current)){ allSame=false; break; }
    }
    if(allSame){ skipped += updated; updated = 0; }
  }
  const icsOut = buildICS(finalEvents, calendarName);
  try {
    const putRes = await fetch(url, { method:'PUT', headers: { ...headers, 'Content-Type':'text/calendar' }, body: icsOut });
    if(!putRes.ok){
      let detail='';
      try { detail = (await putRes.text())?.slice(0,200)||''; } catch(_){ }
      throw new Error('上传失败: '+ putRes.status + (detail? (' '+detail):''));
    }
  } catch(e){ throw new Error('上传 Radicale 失败: ' + (e?.message||e)); }
  const total = finalEvents.length;
  return { ok:true, total, inserted, updated, skipped, deleted, coverage: !!meta?.coverage };
}

// ---------------- Google Calendar Support ----------------
function toRfc3339(dt){ return (dt instanceof Date ? dt : new Date(dt)).toISOString(); }

function toDateOnlyString(raw, dateObj){
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d{8}$/.test(trimmed)) {
      return `${trimmed.slice(0,4)}-${trimmed.slice(4,6)}-${trimmed.slice(6,8)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }
  if (dateObj instanceof Date && !isNaN(dateObj)) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

function formatDateTimeForZone(date, timeZone) {
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(date);
    const comp = {};
    for (const part of parts) {
      if (part.type === 'literal') continue;
      comp[part.type] = part.value;
    }
    if (!comp.year || !comp.month || !comp.day) throw new Error('format failure');
    const hour = comp.hour || '00';
    const minute = comp.minute || '00';
    const second = comp.second || '00';
    const base = `${comp.year}-${comp.month}-${comp.day}T${hour}:${minute}:${second}`;
    const utcMillis = Date.parse(`${base}Z`);
    if (!Number.isFinite(utcMillis)) throw new Error('invalid base');
    const offsetMinutes = Math.round((utcMillis - date.getTime()) / 60000);
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return { dateTime: `${base}${sign}${hh}:${mm}`, offsetMinutes };
  } catch (_err) {
    return { dateTime: toRfc3339(date), offsetMinutes: null };
  }
}

function normalizeRecurrenceEntry(entry) {
  const str = String(entry || '').trim();
  if (!str) return '';
  const idx = str.indexOf(':');
  if (idx === -1) {
    return `RRULE:${str.toUpperCase()}`;
  }
  const prefix = str.slice(0, idx).toUpperCase();
  const rest = str.slice(idx + 1).trim();
  if (prefix === 'RRULE') {
    return `RRULE:${rest.toUpperCase()}`;
  }
  return `${prefix}:${rest}`;
}

function buildGoogleRecurrence(ev) {
  const fromArray = (arr) => {
    const out = arr.map((item) => normalizeRecurrenceEntry(item)).filter(Boolean);
    return out.length ? out : undefined;
  };
  if (Array.isArray(ev?.recurrence) && ev.recurrence.length) {
    return fromArray(ev.recurrence);
  }
  if (ev?.rrule) {
    const single = normalizeRecurrenceEntry(ev.rrule);
    return single ? [single] : undefined;
  }
  return undefined;
}

function prepareGoogleDate(ev, kind) {
  const isStart = kind === 'start';
  const dateObj = isStart ? ev.startTime : ev.endTime;
  const raw = isStart ? ev.startTimeRaw : ev.endTimeRaw;
  const isDateOnly = isStart
    ? !!(ev.startTimeIsDate ?? ev.startIsDate ?? ev.allDay)
    : !!(ev.endTimeIsDate ?? ev.endIsDate ?? ev.allDay);
  const dateText = isStart
    ? (ev.startDateText || toDateOnlyString(raw, dateObj))
    : (ev.endDateText || toDateOnlyString(raw, dateObj));
  const tz = isStart
    ? (ev.startTimeZone || ev.timeZone || null)
    : (ev.endTimeZone || ev.timeZone || null);
  if (isDateOnly) {
    const dateVal = dateText || toDateOnlyString(null, dateObj);
    if (!dateVal) return { payload: null, signature: '' };
    return { payload: { date: dateVal }, signature: `date:${dateVal}` };
  }
  if (!(dateObj instanceof Date) || isNaN(dateObj)) {
    return { payload: null, signature: '' };
  }
  if (tz) {
    const formatted = formatDateTimeForZone(dateObj, tz);
    return { payload: { dateTime: formatted.dateTime, timeZone: tz }, signature: `${formatted.dateTime}|tz:${tz}` };
  }
  const iso = toRfc3339(dateObj);
  return { payload: { dateTime: iso, timeZone: 'UTC' }, signature: `${iso}|tz:UTC` };
}

function prepareGoogleEvent(ev) {
  if (!ev || !ev.title) return null;
  const startPrep = prepareGoogleDate(ev, 'start');
  const endPrep = prepareGoogleDate(ev, 'end');
  if (!startPrep.payload || !endPrep.payload) return null;
  const recurrence = buildGoogleRecurrence(ev);
  const recurrenceKey = recurrence ? recurrence.join(';') : '';
  const title = (ev.title || ev.summary || '').trim().toLowerCase();
  const location = (ev.location || '').trim().toLowerCase();
  const startSig = (startPrep.signature || '').toLowerCase();
  const endSig = (endPrep.signature || '').toLowerCase();
  const signature = `${title}|${startSig}|${endSig}|${location}|${recurrenceKey.toLowerCase()}`;
  return { signature, startPrep, endPrep, recurrence, event: ev };
}

function buildExistingGoogleSignature(item) {
  if (!item) return '';
  const title = (item.summary || '').trim().toLowerCase();
  const location = (item.location || '').trim().toLowerCase();
  let startSig = '';
  if (item.start?.date) {
    startSig = `date:${item.start.date}`;
  } else {
    const dt = (item.start?.dateTime || '').trim().toLowerCase();
    const tz = (item.start?.timeZone || '').trim().toLowerCase();
    startSig = `${dt}|tz:${tz}`;
  }
  let endSig = '';
  if (item.end?.date) {
    endSig = `date:${item.end.date}`;
  } else {
    const dt = (item.end?.dateTime || '').trim().toLowerCase();
    const tz = (item.end?.timeZone || '').trim().toLowerCase();
    endSig = `${dt}|tz:${tz}`;
  }
  const recurrenceKey = Array.isArray(item.recurrence) && item.recurrence.length
    ? item.recurrence.map((entry) => normalizeRecurrenceEntry(entry)).filter(Boolean).join(';').toLowerCase()
    : '';
  return `${title}|${startSig.toLowerCase()}|${endSig.toLowerCase()}|${location}|${recurrenceKey}`;
}

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

async function uploadToGoogleCalendar(events, calendarName, server, meta = {}){
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
  const existingBySig = new Map();
  const existingByUid = new Map();
  const existingByDayTitle = new Map(); // day+title logical mapping
  function buildDayTitleKeyFromExisting(item){
    if(!item) return '';
    const title = (item.summary||'').trim().toLowerCase();
    if(!title) return '';
    let datePart = '';
    if(item.start?.date){
      datePart = item.start.date; // already YYYY-MM-DD
    } else if(item.start?.dateTime){
      try { const dt = new Date(item.start.dateTime); if(!isNaN(dt)) datePart = dt.toISOString().slice(0,10); } catch(_){ }
    }
    if(!datePart) return '';
    return `${title}|${datePart}`;
  }
  for (const it of existing) {
    const sig = buildExistingGoogleSignature(it);
    if (sig && !existingBySig.has(sig)) existingBySig.set(sig, it);
    const iCal = (it.iCalUID || '').trim().toLowerCase();
    if(iCal && !existingByUid.has(iCal)) existingByUid.set(iCal, it);
    const k = buildDayTitleKeyFromExisting(it);
    if(k && !existingByDayTitle.has(k)) existingByDayTitle.set(k, it);
  }
  function normalizeStartEndPayload(item){
    if(!item) return { start:null, end:null };
    const start = item.start?.date ? { date: item.start.date } : (item.start?.dateTime ? { dateTime: item.start.dateTime, timeZone: item.start.timeZone } : null);
    const end = item.end?.date ? { date: item.end.date } : (item.end?.dateTime ? { dateTime: item.end.dateTime, timeZone: item.end.timeZone } : null);
    return { start, end };
  }
  function sameDateLike(a,b){
    if(!a || !b) return false;
    if(a.date && b.date) return a.date === b.date; // all-day
    if(a.dateTime && b.dateTime){
      const t1 = Date.parse(a.dateTime);
      const t2 = Date.parse(b.dateTime);
      if(Number.isFinite(t1) && Number.isFinite(t2)) return t1 === t2; // absolute instant match
    }
    return false;
  }
  function arraysEqual(a,b){ if(!Array.isArray(a)&&!Array.isArray(b)) return true; if(!Array.isArray(a)||!Array.isArray(b)) return false; if(a.length!==b.length) return false; for(let i=0;i<a.length;i++){ if(a[i]!==b[i]) return false; } return true; }
  const toInsert = []; const toUpdate = []; let skipped = 0;
  const incomingSignatures = new Set();
  const incomingUids = new Set();
  function dayTitleKeyForIncoming(ev){
    if(!ev || !ev.startTime || !ev.title) return '';
    const d = ev.startTime instanceof Date ? ev.startTime : new Date(ev.startTime);
    if(!(d instanceof Date) || isNaN(d)) return '';
    const datePart = d.toISOString().slice(0,10);
    return `${(ev.title||'').trim().toLowerCase()}|${datePart}`;
  }
  function sameGoogleLogical(existingItem, prepared, ev){
    const { start: exStart, end: exEnd } = normalizeStartEndPayload(existingItem);
    const wantStart = prepared.startPrep.payload;
    const wantEnd = prepared.endPrep.payload;
    const wantRecurrence = (prepared.recurrence || []).map(r=> r.trim().toUpperCase());
    const existingRecurrence = Array.isArray(existingItem.recurrence)? existingItem.recurrence.map(r=> r.trim()).map(r=> r.toUpperCase()): [];
    // Normalize alarms (popup reminders) for comparison
    function normAlarmsGoogle(item){
      const overrides = item?.reminders?.overrides;
      if(!Array.isArray(overrides) || !overrides.length || item?.reminders?.useDefault) return [];
      return overrides.filter(o=> o && (o.method==='popup'||!o.method)).map(o=> Number(o.minutes)).filter(m=> Number.isFinite(m)).sort((a,b)=>a-b);
    }
    function normAlarmsEv(evObj){
      if(!Array.isArray(evObj?.alarms)) return [];
      return evObj.alarms.map(a=> Number(a.minutesBefore)).filter(m=> Number.isFinite(m) && m>0).sort((a,b)=>a-b);
    }
    const existingAlarms = normAlarmsGoogle(existingItem);
    const wantAlarms = normAlarmsEv(ev);
    const sameAlarms = existingAlarms.length === wantAlarms.length && existingAlarms.every((v,i)=> v===wantAlarms[i]);
    // Compare start/end with instant equivalence (timezone-insensitive)
    const sameStart = (()=>{
      if(!exStart || !wantStart) return false;
      if(exStart.date || wantStart.date) return exStart.date === wantStart.date;
      return sameDateLike(exStart, wantStart);
    })();
    const sameEnd = (()=>{
      if(!exEnd || !wantEnd) return false;
      if(exEnd.date || wantEnd.date) return exEnd.date === wantEnd.date;
      return sameDateLike(exEnd, wantEnd);
    })();
    const sameRecurrence = arraysEqual(existingRecurrence, wantRecurrence);
    // Description normalization (treat 'Reminder' placeholder as empty)
    const descA = (/^Reminder$/i.test(existingItem.description||'') ? '' : (existingItem.description||'').trim());
    const descB = (/^Reminder$/i.test(ev.description||'') ? '' : (ev.description||'').trim());
    const sameDesc = descA === descB;
    return (existingItem.summary||'').trim() === (ev.title||'').trim()
      && (existingItem.location||'').trim() === (ev.location||'').trim()
      && sameStart && sameEnd && sameRecurrence && sameAlarms && sameDesc;
  }
  for(const ev of events){
    const prepared = prepareGoogleEvent(ev); if(!prepared){ skipped++; continue; }
    incomingSignatures.add(prepared.signature);
    const uid = (ev.uid || ev.id || '').trim();
    const lowerUid = uid.toLowerCase();
    if(lowerUid) incomingUids.add(lowerUid);
    const existingByThisUid = lowerUid ? existingByUid.get(lowerUid) : null;
    if(existingByThisUid){
      if(sameGoogleLogical(existingByThisUid, prepared, ev)){ skipped++; continue; }
      toUpdate.push({ prepared, existing: existingByThisUid });
      continue;
    }
    // Day + title matching
    const dayTitleKey = dayTitleKeyForIncoming(ev);
    if(dayTitleKey && existingByDayTitle.has(dayTitleKey)){
      const existingItem = existingByDayTitle.get(dayTitleKey);
      if(sameGoogleLogical(existingItem, prepared, ev)){ skipped++; continue; }
      toUpdate.push({ prepared, existing: existingItem });
      continue;
    }
    // Fallback signature exact match (identical content)
    if(existingBySig.has(prepared.signature)){ skipped++; continue; }
    toInsert.push(prepared);
  }
  // Collapse no-op updates (reclassification) in case timezone / description / recurrence canonicalization deems them identical
  if(toUpdate.length){
    const stillUpdate = [];
    for(const item of toUpdate){
      if(sameGoogleLogical(item.existing, item.prepared, item.prepared.event)){
        skipped++; // treat as skipped now
      } else {
        stillUpdate.push(item);
      }
    }
    toUpdate.length = 0; toUpdate.push(...stillUpdate);
  }
  // Coverage deletion plan (Google): delete existing events inside window that are not present in incoming
  let toDelete = [];
  if(meta?.coverage && meta.windowStart instanceof Date && meta.windowEnd instanceof Date){
    const startMs = meta.windowStart.getTime();
    const endMs = meta.windowEnd.getTime();
    for(const ex of existing){
      // Derive start time millis
      let sMs = NaN;
      if(ex.start?.dateTime){ sMs = Date.parse(ex.start.dateTime); }
      else if(ex.start?.date){ sMs = Date.parse(ex.start.date + 'T00:00:00Z'); }
      if(!Number.isFinite(sMs)) continue;
      if(sMs < startMs || sMs > endMs) continue; // outside window keep
      const sig = buildExistingGoogleSignature(ex);
      const uidLower = (ex.iCalUID||'').trim().toLowerCase();
      if((uidLower && incomingUids.has(uidLower)) || (sig && incomingSignatures.has(sig))){
        continue; // present in new set
      }
      // Skip deleting expanded instances of recurring series to avoid partial deletions (heuristic)
      if(ex.recurringEventId){
        continue; // leave recurring series management to future improvement
      }
      toDelete.push(ex);
    }
  }
  async function authRetryWrapper(doRequest){
    let res = await doRequest();
    if(res.status === 401){
      if(hasManifestOauth && chrome?.identity?.getAuthToken){
        try {
          const refreshed = await refreshChromeIdentityToken(accessToken);
          if(refreshed){ const stored = await persistIdentityToken(refreshed); accessToken = stored?.access_token || refreshed; }
          res = await doRequest();
        } catch(_){ }
      }
      if(res.status === 401){
        const t3 = await refreshGoogleToken(server.id, { clientId, clientSecret });
        if(t3?.access_token || t3?.accessToken){ accessToken = t3.access_token||t3.accessToken; res = await doRequest(); }
      }
    }
    return res;
  }
  let inserted = 0, updated = 0, deleted = 0;
  // Perform deletions first to keep window clean (optional ordering)
  for(const ex of toDelete){
    const delUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ex.id)}`;
    const res = await authRetryWrapper(()=> fetch(delUrl, { method:'DELETE', headers:{ 'Authorization': `Bearer ${accessToken}` } }));
    if(res.status === 204 || res.status === 200){ deleted++; continue; }
    if(res.status === 404){ continue; }
    throw new Error('删除事件失败: ' + res.status);
  }
  for(const item of toUpdate){
    const { prepared, existing: ex } = item;
    const ev = prepared.event;
    const body = { summary: ev.title, location: ev.location || undefined, description: ev.description? String(ev.description):undefined, start: prepared.startPrep.payload, end: prepared.endPrep.payload };
    if(Array.isArray(ev.alarms) && ev.alarms.length){
      const overrides = ev.alarms.map(a=> Number(a.minutesBefore)).filter(m=> Number.isFinite(m) && m>0).map(m=> ({ method:'popup', minutes: m }));
      if(overrides.length) body.reminders = { useDefault: false, overrides };
    }
    if(prepared.recurrence && prepared.recurrence.length) body.recurrence = prepared.recurrence;
    const updateUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ex.id)}`;
    const res = await authRetryWrapper(()=> fetch(updateUrl, { method:'PATCH', headers:{ 'Authorization': `Bearer ${accessToken}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) }));
    if(res.ok) updated++; else { if(res.status === 409){ updated++; continue; } throw new Error('更新事件失败: ' + res.status); }
  }
  for(const prepared of toInsert){
    const ev = prepared.event;
    const body = { summary: ev.title, location: ev.location || undefined, description: ev.description? String(ev.description):undefined, start: prepared.startPrep.payload, end: prepared.endPrep.payload };
    if(Array.isArray(ev.alarms) && ev.alarms.length){
      const overrides = ev.alarms.map(a=> Number(a.minutesBefore)).filter(m=> Number.isFinite(m) && m>0).map(m=> ({ method:'popup', minutes: m }));
      if(overrides.length) body.reminders = { useDefault: false, overrides };
    }
    if(prepared.recurrence && prepared.recurrence.length) body.recurrence = prepared.recurrence;
    if(ev.uid) body.iCalUID = String(ev.uid); else if(ev.id) body.iCalUID = String(ev.id);
    const createUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const res = await authRetryWrapper(()=> fetch(createUrl, { method:'POST', headers:{ 'Authorization': `Bearer ${accessToken}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) }));
    if(res.ok){ inserted++; continue; }
    if(res.status === 409){ try { const errJson = await res.json(); if(errJson?.error?.errors?.[0]?.reason === 'duplicate'){ skipped++; continue; } } catch(_){ } }
    throw new Error('插入事件失败: ' + res.status);
  }
  const total = existing.length - deleted + inserted; // updates don't change count
  return { ok:true, total, inserted, updated, skipped, deleted, coverage: !!meta?.coverage };
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
  // Prefer PKCE (refresh token) by default; implicit only as explicit fallback
  let mode = cfg.oauthMode;
  if(!mode){
    mode = 'pkce';
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
      // Could not complete PKCE due to secret requirement; fallback to implicit
      await updateServerConfig(serverId, { oauthMode: 'implicit' });
      throw new Error('当前 Client ID 需要 Client Secret，已切换为隐式模式，请重新点一次“授权”。（若需长期免登录，请使用支持无密 PKCE 的 OAuth 客户端）');
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
