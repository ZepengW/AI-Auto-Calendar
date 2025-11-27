// Shared constants & helpers (extracted from userscript)
// ----------------------------------------------------
// DEFAULTS: unified default configuration for storage fallbacks
export const DEFAULTS = {
  // 默认不再预置本地 Radicale，避免无意自动访问 127.0.0.1 请求权限
  radicalBase: '',
  radicalUsername: '',
  radicalAuth: '',
  autoSyncMinutes: 60,
  dateWindowDays: 14,
  enableNotifications: true,
  lastSync: null,
  llmApiUrl: 'https://open.bigmodel.cn/api/llm-application/open/v3/application/invoke',
  llmApiKey: '',
  llmProvider: 'zhipu_agent',
  llmAgentId: '1954810625930809344',
  // OpenAI style defaults
  openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
  openaiApiKey: '',
  openaiModel: 'gpt-5',
  // Bailian defaults
  // Use apps completion API base; final endpoint will be `${bailianApiUrl}/{app_id}/completion`
  bailianApiUrl: 'https://dashscope.aliyuncs.com/api/v1/apps',
  bailianAgentId: '1ca80897bf214db08d43654aa2264f3d',
  bailianApiKey: '',
  // Google defaults (dev time). For production prefer Chrome Identity manifest oauth2.
  googleClientId: '',
  googleCalendarId: 'primary',
  // 页面解析（fetch 策略下）JSON 直取配置
  pageParseJsonMode: 'llm', // 'llm' | 'json'  -> json 表示直接按路径提取事件，不调用 LLM
  // 多行 JSON 路径，示例： data.events[*]\n data.schoolCalendar.events[*]
  // 语法： path = seg(.seg)*  seg = key | key[index] | key[*] | [index] | [*]
  // key: /^[A-Za-z0-9_]+$/; index: 数字
  pageParseJsonPaths: 'data.events[*]',
  debugServerDiff: true, // 调试日志默认开启（UI 已移除，可直接修改存储关闭）
};

// Helper: prefer manifest.oauth2 client_id (MV3) instead of packaged dev config
export function getGoogleClientId(){
  try {
    const manifest = chrome?.runtime?.getManifest?.();
    if(manifest && manifest.oauth2 && manifest.oauth2.client_id){
      return manifest.oauth2.client_id;
    }
  } catch(_){ /* ignore */ }
  // Fallback to settings / packaged config merging path using DEFAULTS.googleClientId
  return DEFAULTS.googleClientId || '';
}

// Pages where calendar features are active
export const allowedPages = ['my.sjtu.edu.cn/ui/calendar'];

// Storage helpers
export function getStorageArea() {
  return chrome?.storage?.local;
}

export async function loadSettings() {
  const area = getStorageArea();
  const data = await area.get(null);
  return { ...DEFAULTS, ...data };
}

export async function saveSettings(patch) {
  const area = getStorageArea();
  await area.set(patch);
}

// HTML escaping for injected markup
export function escapeHTML(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Date & time utilities
export function formatDateForAPI(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}+00:00`;
}

export function isoToICSTime(dt) {
  const s = dt.toISOString();
  return s.replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}

export function parseSJTUTime(s) {
  const m = s && s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

// parseLLMTime: 尝试解析多种可能的 LLM 返回格式
// 支持示例：
// 1) 2025-09-05 15:00  -> 视为本地时区
// 2) 2025-09-05 15:00:00
// 3) 2025/09/05 15:00
// 4) 2025-09-05T15:00:00+0800 / +08:00
// 5) 20250905T150000+0800 (原格式)
// 6) 2025-09-05T150000+0800
export function parseLLMTime(s) {
  if (!s) return null;
  const str = s.trim();
  // Compact UTC with Z: YYYYMMDDTHHmmssZ
  let m2 = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if(m2){
    const [_, y, mm, d, H, M, S] = m2; // eslint-disable-line no-unused-vars
    return new Date(`${y}-${mm}-${d}T${H}:${M}:${S}Z`);
  }
  // 原紧凑格式 YYYYMMDDTHHmmss+ZZZZ
  let m = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})$/);
  if (m) {
    const [_, y, mm, d, H, M, S, tz] = m; // eslint-disable-line no-unused-vars
    return new Date(`${y}-${mm}-${d}T${H}:${M}:${S}${tz}`);
  }
  // 变体：YYYY-MM-DDTHHmmss+0800
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})$/);
  if (m) {
    const [_, y, mm, d, H, M, S, tz] = m;
    return new Date(`${y}-${mm}-${d}T${H}:${M}:${S}${tz}`);
  }
  // ISO 基本：YYYY-MM-DDTHH:MM(:SS)?(Z|+08:00|+0800)?
  m = str.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    let [_, y, mm, d, H, M, S = '00', tz = ''] = m;
    if (tz && /^([+-]\d{2})(\d{2})$/.test(tz)) { // +0800 -> +08:00
      tz = tz.replace(/([+-]\d{2})(\d{2})/, '$1:$2');
    }
    return new Date(`${y}-${mm}-${d}T${H}:${M}:${S}${tz}`);
  }
  return null;
}

export function escapeICSText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/, /g, ',')
    .replace(/;/g, '\\;');
}

export function unescapeICSText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function unfoldIcsLines(text) {
  if (!text) return [];
  const rawLines = String(text).replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const line of rawLines) {
    if (!lines.length) {
      lines.push(line);
      continue;
    }
    if (line.startsWith(' ') || line.startsWith('\t')) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseICSTimestamp(value, params = []) {
  if (!value) return null;
  const v = String(value).trim();
  const tzParam = params.find((p) => p.startsWith('TZID='));
  const tz = tzParam ? tzParam.split('=')[1] : null;

  // All-day date (VALUE=DATE)
  const dateOnly = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    const [_, y, m, d] = dateOnly;
    if (tz) {
      // treat as local date for the timezone (fallback to local browser time)
      return new Date(Number(y), Number(m) - 1, Number(d));
    }
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  const basic = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}:?\d{2})?$/i);
  if (basic) {
    const [_, y, mon, d, H, M, S, zone] = basic;
    const iso = `${y}-${mon}-${d}T${H}:${M}:${S}`;
    if (zone && zone.toUpperCase() === 'Z') {
      return new Date(`${iso}Z`);
    }
    if (zone && zone.includes(':')) {
      return new Date(`${iso}${zone}`);
    }
    if (zone && zone.length === 5) {
      const withColon = `${zone.slice(0, 3)}:${zone.slice(3)}`;
      return new Date(`${iso}${withColon}`);
    }
    if (tz) {
      // For TZID we currently fall back to local interpretation
      return new Date(Number(y), Number(mon) - 1, Number(d), Number(H), Number(M), Number(S));
    }
    return new Date(`${iso}`);
  }

  const parsed = parseLLMTime(v);
  if (parsed) return parsed;
  return null;
}

export function parseICSDuration(value) {
  if (!value) return null;
  const str = String(value).trim().toUpperCase();
  if (!str) return null;
  let sign = 1;
  let body = str;
  if (body.startsWith('-')) { sign = -1; body = body.slice(1); }
  else if (body.startsWith('+')) { body = body.slice(1); }
  if (!body.startsWith('P')) return null;
  body = body.slice(1);
  if (!body) return null;
  if (/^0$/.test(body)) return 0;

  let weeks = 0, days = 0, hours = 0, minutes = 0, seconds = 0;
  const weekMatch = body.match(/^(\d+)W$/);
  if (weekMatch) {
    weeks = Number(weekMatch[1]);
  } else {
    const regex = /^(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
    const m = body.match(regex);
    if (!m) return null;
    const years = m[1] ? Number(m[1]) : 0;
    const months = m[2] ? Number(m[2]) : 0;
    weeks = m[3] ? Number(m[3]) : 0;
    days = m[4] ? Number(m[4]) : 0;
    hours = m[5] ? Number(m[5]) : 0;
    minutes = m[6] ? Number(m[6]) : 0;
    seconds = m[7] ? Number(m[7]) : 0;
    if (years) days += years * 365;
    if (months) days += months * 30;
  }

  const totalMs = sign * (
    weeks * 7 * 24 * 60 * 60 * 1000 +
    days * 24 * 60 * 60 * 1000 +
    hours * 60 * 60 * 1000 +
    minutes * 60 * 1000 +
    seconds * 1000
  );
  return Number.isFinite(totalMs) ? totalMs : null;
}

function extractParamValue(params, name) {
  if (!Array.isArray(params) || !name) return null;
  const upper = name.toUpperCase();
  for (const raw of params) {
    if (!raw && raw !== '') continue;
    const [k, v] = String(raw).split('=');
    if (!k) continue;
    if (k.trim().toUpperCase() !== upper) continue;
    if (v == null) return '';
    return String(v).trim().replace(/^"|"$/g, '');
  }
  return null;
}

function paramsContainDateValue(params) {
  if (!Array.isArray(params) || !params.length) return false;
  for (const raw of params) {
    if (!raw && raw !== '') continue;
    const [k, v] = String(raw).split('=');
    if (!k) continue;
    if (k.trim().toUpperCase() !== 'VALUE') continue;
    if ((v || '').trim().toUpperCase() === 'DATE') return true;
  }
  return false;
}

function normalizeDateOnlyString(raw, fallbackDate) {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    let m = trimmed.match(/^([0-9]{4})([0-9]{2})([0-9]{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = trimmed.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const date = fallbackDate instanceof Date && !isNaN(fallbackDate) ? fallbackDate : null;
  if (date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return undefined;
}

export function parseICS(text) {
  const lines = unfoldIcsLines(text);
  const events = [];
  let cur = null;
  const finalizeCurrent = () => {
    if (!cur) return;
    if (cur.startTime instanceof Date && !cur.endTime && Number.isFinite(cur.durationMs)) {
      const computedEnd = new Date(cur.startTime.getTime() + cur.durationMs);
      if (!isNaN(computedEnd)) {
        cur.endTime = computedEnd;
        cur.endTimeRaw = cur.endTimeRaw || isoToICSTime(computedEnd);
      }
    }
    if (Array.isArray(cur.rawLines) && cur.rawLines.length) {
      cur.rawICS = cur.rawLines.join('\n');
      delete cur.rawLines;
    }
    events.push(cur);
    cur = null;
  };
  for (const raw of lines) {
    if (!raw) continue;
    const line = raw.trim();
    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      finalizeCurrent();
      cur = { rawProps: {}, rawParams: {}, rawLines: [raw] };
      continue;
    }
    if (line.toUpperCase() === 'END:VEVENT') {
      if (cur && Array.isArray(cur.rawLines)) cur.rawLines.push(raw);
      finalizeCurrent();
      continue;
    }
    if (!cur) continue;
    if (Array.isArray(cur.rawLines)) cur.rawLines.push(raw);
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const keyPart = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [primaryKey, ...rest] = keyPart.split(';');
    const key = (primaryKey || '').toUpperCase();
    const params = rest.map((seg) => String(seg || '').trim()).filter(Boolean);
    cur.rawProps[key] = value;
    cur.rawParams[key] = params;
    if (key === 'UID') cur.uid = value;
    if (key === 'SUMMARY') cur.title = unescapeICSText(value);
    if (key === 'LOCATION') cur.location = unescapeICSText(value);
    if (key === 'DESCRIPTION') cur.description = unescapeICSText(value);
    if (key === 'STATUS') cur.status = value;
    if (key === 'RRULE') cur.rrule = value;
    if (key === 'DTSTART') {
      cur.startTimeRaw = value;
      cur.startTimeParams = params;
      const tzid = extractParamValue(params, 'TZID');
      const hasUtc = String(value).trim().toUpperCase().endsWith('Z');
      const isDateOnly = paramsContainDateValue(params) || /^\d{8}$/.test(String(value).trim());
      if (tzid) cur.startTimeZone = tzid;
      else if (hasUtc) cur.startTimeZone = 'UTC';
      if (isDateOnly) {
        cur.startIsDate = true;
        cur.startDateText = normalizeDateOnlyString(value);
        cur.allDay = true;
      }
      const dt = parseICSTimestamp(value, params);
      if (dt) cur.startTime = dt;
      if (!cur.startDateText && isDateOnly && dt instanceof Date) {
        cur.startDateText = normalizeDateOnlyString(null, dt);
      }
      if (!cur.timeZone && cur.startTimeZone) cur.timeZone = cur.startTimeZone;
    }
    if (key === 'DTEND') {
      cur.endTimeRaw = value;
      cur.endTimeParams = params;
      const tzid = extractParamValue(params, 'TZID');
      const hasUtc = String(value).trim().toUpperCase().endsWith('Z');
      const isDateOnly = paramsContainDateValue(params) || /^\d{8}$/.test(String(value).trim());
      if (tzid) cur.endTimeZone = tzid;
      else if (hasUtc) cur.endTimeZone = 'UTC';
      if (isDateOnly) {
        cur.endIsDate = true;
        cur.endDateText = normalizeDateOnlyString(value);
        cur.allDay = true;
      }
      const dt = parseICSTimestamp(value, params);
      if (dt) cur.endTime = dt;
      if (!cur.endDateText && isDateOnly && dt instanceof Date) {
        cur.endDateText = normalizeDateOnlyString(null, dt);
      }
      if (!cur.timeZone && cur.endTimeZone) cur.timeZone = cur.endTimeZone;
    }
    if (key === 'DURATION') {
      cur.durationRaw = value;
      const durationMs = parseICSDuration(value);
      if (Number.isFinite(durationMs)) {
        cur.durationMs = durationMs;
        if (cur.startTime instanceof Date) {
          const computedEnd = new Date(cur.startTime.getTime() + durationMs);
          if (!isNaN(computedEnd)) {
            cur.endTime = computedEnd;
            cur.endTimeRaw = cur.endTimeRaw || isoToICSTime(computedEnd);
          }
        }
      }
    }
  }
  finalizeCurrent();
  return events;
}

function coerceToDate(input) {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(input).trim();
  if (!str) return null;
  const fromIcs = parseICSTimestamp(str);
  if (fromIcs) return fromIcs;
  const sjtu = parseSJTUTime(str);
  if (sjtu) return sjtu;
  const llm = parseLLMTime(str);
  if (llm) return llm;
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function pickFirst(obj, keys = []) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) {
      return obj[key];
    }
  }
  return undefined;
}

function normalizeSingleEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const title = String(pickFirst(ev, ['title', 'summary', 'name']) || '').trim();
  const location = String(pickFirst(ev, ['location', 'place']) || '').trim();
  const descriptionRaw = pickFirst(ev, ['description', 'desc', 'detail']);
  const description = descriptionRaw == null ? '' : String(descriptionRaw);
  const startRaw = pickFirst(ev, ['startTime', 'start_time', 'begin', 'dtstart', 'startTimeRaw']);
  const endRaw = pickFirst(ev, ['endTime', 'end_time', 'finish', 'dtend', 'endTimeRaw']);
  const durationRaw = pickFirst(ev, ['durationMs', 'duration', 'durationRaw']);
  const rruleRaw = pickFirst(ev, ['rrule', 'RRULE']);
  const startIsDateHint = pickFirst(ev, ['startTimeIsDate', 'startIsDate', 'startDateOnly', 'allDay']);
  const endIsDateHint = pickFirst(ev, ['endTimeIsDate', 'endIsDate', 'endDateOnly', 'allDay']);
  const startTimeZoneHint = pickFirst(ev, ['startTimeZone', 'timeZone', 'timezone']);
  const endTimeZoneHint = pickFirst(ev, ['endTimeZone', 'timeZone', 'timezone']);
  const startDate = coerceToDate(startRaw);
  let endDate = coerceToDate(endRaw);
  if (!endDate && startDate && durationRaw != null) {
    let durationMs = null;
    if (typeof durationRaw === 'number' && Number.isFinite(durationRaw)) durationMs = durationRaw;
    else if (typeof durationRaw === 'string') durationMs = parseICSDuration(durationRaw);
    if (Number.isFinite(durationMs)) {
      const computed = new Date(startDate.getTime() + durationMs);
      if (!isNaN(computed)) endDate = computed;
    }
  }
  if (!endDate && startDate) {
    endDate = new Date(startDate.getTime());
  }
  if (!title || !startDate || !endDate) return null;
  const looksLikeDateOnly = (val) => {
    if (val == null) return false;
    const str = String(val).trim();
    if (!str) return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(str) || /^\d{8}$/.test(str);
  };
  const startIsDate = startIsDateHint !== undefined ? Boolean(startIsDateHint) : looksLikeDateOnly(startRaw);
  const endIsDate = endIsDateHint !== undefined ? Boolean(endIsDateHint) : looksLikeDateOnly(endRaw);
  let startTimeZone = startTimeZoneHint ? String(startTimeZoneHint) : undefined;
  let endTimeZone = endTimeZoneHint ? String(endTimeZoneHint) : undefined;
  if (!startTimeZone && typeof startRaw === 'string' && startRaw.trim().toUpperCase().endsWith('Z')) startTimeZone = 'UTC';
  if (!endTimeZone && typeof endRaw === 'string' && endRaw.trim().toUpperCase().endsWith('Z')) endTimeZone = 'UTC';
  const startDateText = startIsDate ? (ev.startDateText || normalizeDateOnlyString(typeof startRaw === 'string' ? startRaw : null, startDate)) : undefined;
  const endDateText = endIsDate ? (ev.endDateText || normalizeDateOnlyString(typeof endRaw === 'string' ? endRaw : null, endDate)) : undefined;
  const allDay = startIsDate && endIsDate;
  const uidRaw = pickFirst(ev, ['uid', 'id', 'eventId']);
  const uid = uidRaw ? String(uidRaw) : undefined;
  const primaryTimeZone = pickFirst(ev, ['timeZone', 'timezone']) || startTimeZone || endTimeZone;
  return {
    ...ev,
    title,
    location,
    description,
    uid,
    id: uid || ev.id,
    startTime: startDate,
    endTime: endDate,
    startTimeRaw: startRaw ?? startDate?.toISOString?.(),
    endTimeRaw: endRaw ?? endDate?.toISOString?.(),
    rrule: rruleRaw || undefined,
    startTimeIsDate: startIsDate || undefined,
    endTimeIsDate: endIsDate || undefined,
    startDateText,
    endDateText,
    startTimeZone: startTimeZone || undefined,
    endTimeZone: endTimeZone || undefined,
    timeZone: primaryTimeZone || undefined,
    allDay: allDay || undefined,
    rawICS: ev.rawICS || (ev.raw && ev.raw.rawICS) || undefined,
    raw: ev.raw || ev.rawProps || ev,
  };
}

export function normalizeCalendarEvents(events = []) {
  return events
    .map((ev) => normalizeSingleEvent(ev))
    .filter((ev) => !!ev);
}

const DEFAULT_PRODID = '-//SJTU-Auto-Calendar//EN';

export function buildEventSignature(ev) {
  if (!ev) return '';
  const normalized = normalizeSingleEvent(ev);
  if (!normalized) return '';
  const s = normalized.startTime?.toISOString?.() || '';
  const e = normalized.endTime?.toISOString?.() || '';
  const loc = (normalized.location || '').toLowerCase().trim();
  return `${normalized.title.toLowerCase().trim()}|${s}|${e}|${loc}`;
}

const DAY_MS = 86400000;

function parseRRuleString(raw) {
  if (!raw) return null;
  const body = raw.trim().replace(/^RRULE:/i, '').trim();
  if (!body) return null;
  const parts = body.split(';').map((seg) => seg.trim()).filter(Boolean);
  const rule = {};
  for (const seg of parts) {
    const [kRaw, vRaw] = seg.split('=');
    const key = (kRaw || '').trim().toUpperCase();
    const value = (vRaw || '').trim();
    if (!key || !value) continue;
    if (key === 'FREQ') rule.freq = value.toUpperCase();
    else if (key === 'INTERVAL') {
      const num = Number(value);
      rule.interval = Number.isFinite(num) && num > 0 ? num : 1;
    } else if (key === 'COUNT') {
      const num = Number(value);
      if (Number.isFinite(num) && num > 0) rule.count = Math.floor(num);
    } else if (key === 'UNTIL') {
      const dt = parseICSTimestamp(value) || parseLLMTime(value);
      if (dt instanceof Date && !isNaN(dt)) rule.until = dt;
    } else if (key === 'BYDAY') {
      const items = value.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
      if (items.length) rule.byDay = items;
    } else if (key === 'BYMONTHDAY') {
      const items = value.split(',').map((t) => Number(t.trim())).filter((n) => Number.isFinite(n));
      if (items.length) rule.byMonthDay = items;
    } else if (key === 'WKST') {
      rule.weekStart = value.toUpperCase();
    }
  }
  if (!rule.interval) rule.interval = 1;
  return rule.freq ? rule : null;
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function weekdayCodeToIndex(code) {
  const upper = (code || '').toUpperCase();
  const idx = WEEKDAY_CODES.indexOf(upper);
  return idx >= 0 ? idx : null;
}

function startOfWeek(date, weekStartIdx) {
  const d = new Date(date.getTime());
  const cur = d.getDay();
  const diff = (cur - weekStartIdx + 7) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d;
}

function formatDateOnly(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildOccurrenceUid(baseUid, occStart, index) {
  const base = String(baseUid || 'recur').replace(/[^A-Za-z0-9@._-]/g, '');
  const stamp = occStart instanceof Date && !isNaN(occStart)
    ? occStart.toISOString().replace(/[^0-9A-Za-z]/g, '').slice(0, 15)
    : `idx${index}`;
  return `${base}-${stamp}`;
}

function cloneOccurrence(baseEvent, occStart, durationMs, index) {
  const occEnd = new Date(occStart.getTime() + durationMs);
  const startIsDate = !!(baseEvent.startTimeIsDate || baseEvent.startIsDate || baseEvent.allDay);
  const endIsDate = !!(baseEvent.endTimeIsDate || baseEvent.endIsDate || baseEvent.allDay);
  const uidBase = baseEvent.uid || baseEvent.id || baseEvent.eventId;
  const uid = buildOccurrenceUid(uidBase, occStart, index);
  const startDateText = startIsDate ? formatDateOnly(occStart) : undefined;
  const endDateText = endIsDate ? formatDateOnly(occEnd) : undefined;
  const clone = {
    ...baseEvent,
    uid,
    id: uid,
    eventId: uid,
    startTime: occStart,
    endTime: occEnd,
    startTimeRaw: startIsDate ? startDateText : occStart.toISOString(),
    endTimeRaw: endIsDate ? endDateText : occEnd.toISOString(),
    startDateText: startDateText || baseEvent.startDateText,
    endDateText: endDateText || baseEvent.endDateText,
    startTimeIsDate: startIsDate || undefined,
    endTimeIsDate: endIsDate || undefined,
    allDay: startIsDate && endIsDate ? true : baseEvent.allDay,
    rrule: undefined,
    recurrence: undefined,
    rawICS: undefined,
  };
  if (clone.raw && typeof clone.raw === 'object') clone.raw = { ...clone.raw, rrule: undefined };
  return clone;
}

function expandDaily(event, rule, options, durationMs) {
  const out = [];
  const intervalDays = Math.max(1, rule.interval || 1);
  const maxOccurrences = options.maxOccurrences;
  let remaining = Number.isFinite(rule.count) ? rule.count : Infinity;
  const limitTime = rule.until ? rule.until.getTime() : event.startTime.getTime() + options.horizonMs;
  let current = new Date(event.startTime.getTime());
  let idx = 0;
  while (current.getTime() <= limitTime && out.length < maxOccurrences) {
    if (remaining <= 0) break;
    out.push(cloneOccurrence(event, current, durationMs, idx));
    if (Number.isFinite(remaining)) remaining--;
    if (remaining === 0) break;
    idx++;
    current = new Date(current.getTime() + intervalDays * DAY_MS);
    if (idx > options.maxIterations) break;
  }
  return out;
}

function expandWeekly(event, rule, options, durationMs) {
  const out = [];
  const weekStartIdx = weekdayCodeToIndex(rule.weekStart) ?? 1; // default Monday
  const byDays = (Array.isArray(rule.byDay) && rule.byDay.length) ? rule.byDay.map(weekdayCodeToIndex).filter((n) => n != null) : [];
  if (!byDays.length) byDays.push(event.startTime.getDay());
  byDays.sort((a, b) => a - b);
  const intervalWeeks = Math.max(1, rule.interval || 1);
  let remaining = Number.isFinite(rule.count) ? rule.count : Infinity;
  const limitTime = rule.until ? rule.until.getTime() : event.startTime.getTime() + options.horizonMs;
  const baseWeekStart = startOfWeek(event.startTime, weekStartIdx);
  let weekIndex = 0;
  let totalIterations = 0;
  while (out.length < options.maxOccurrences && totalIterations < options.maxIterations) {
    const currentWeekStart = new Date(baseWeekStart.getTime() + weekIndex * intervalWeeks * 7 * DAY_MS);
    for (const dayIdx of byDays) {
      const occStart = new Date(currentWeekStart.getTime() + dayIdx * DAY_MS);
      occStart.setHours(event.startTime.getHours(), event.startTime.getMinutes(), event.startTime.getSeconds(), event.startTime.getMilliseconds());
      if (occStart.getTime() < event.startTime.getTime()) continue;
      if (occStart.getTime() > limitTime) return out;
      if (remaining <= 0) return out;
      out.push(cloneOccurrence(event, occStart, durationMs, out.length));
      if (Number.isFinite(remaining)) remaining--;
      if (remaining === 0 || out.length >= options.maxOccurrences) return out;
    }
    weekIndex++;
    totalIterations++;
  }
  return out;
}

function expandMonthly(event, rule, options, durationMs) {
  const out = [];
  const intervalMonths = Math.max(1, rule.interval || 1);
  const byMonthDays = (Array.isArray(rule.byMonthDay) && rule.byMonthDay.length)
    ? rule.byMonthDay
    : [event.startTime.getDate()];
  let remaining = Number.isFinite(rule.count) ? rule.count : Infinity;
  const limitTime = rule.until ? rule.until.getTime() : event.startTime.getTime() + options.horizonMs;
  let monthIndex = 0;
  let totalIterations = 0;
  while (out.length < options.maxOccurrences && totalIterations < options.maxIterations) {
    const base = new Date(event.startTime.getTime());
    base.setMonth(base.getMonth() + monthIndex * intervalMonths);
    for (const day of byMonthDays) {
      const occStart = new Date(base.getTime());
      occStart.setDate(day);
      if (occStart.getMonth() !== base.getMonth()) continue; // invalid day for month
      occStart.setHours(event.startTime.getHours(), event.startTime.getMinutes(), event.startTime.getSeconds(), event.startTime.getMilliseconds());
      if (occStart.getTime() < event.startTime.getTime()) continue;
      if (occStart.getTime() > limitTime) return out;
      if (remaining <= 0) return out;
      out.push(cloneOccurrence(event, occStart, durationMs, out.length));
      if (Number.isFinite(remaining)) remaining--;
      if (remaining === 0 || out.length >= options.maxOccurrences) return out;
    }
    monthIndex++;
    totalIterations++;
  }
  return out;
}

function expandSingleRecurringEvent(event, options) {
  const rawRule = event.rrule || (Array.isArray(event.recurrence) ? event.recurrence.find((entry) => typeof entry === 'string' && entry.toUpperCase().startsWith('RRULE')) : null);
  if (!rawRule) return null;
  const rule = parseRRuleString(rawRule);
  if (!rule) return null;
  const start = event.startTime instanceof Date ? event.startTime : coerceToDate(event.startTimeRaw || event.startTime);
  const end = event.endTime instanceof Date ? event.endTime : coerceToDate(event.endTimeRaw || event.endTime);
  if (!(start instanceof Date) || isNaN(start) || !(end instanceof Date) || isNaN(end)) return null;
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  if (durationMs === 0 && !(event.startTimeIsDate || event.endTimeIsDate)) return null;
  const expandOptions = {
    maxOccurrences: options.maxOccurrences,
    horizonMs: options.horizonDays * DAY_MS,
    maxIterations: options.maxIterations,
  };
  let expanded = null;
  if (rule.freq === 'DAILY') {
    expanded = expandDaily(event, rule, expandOptions, durationMs || DAY_MS);
  } else if (rule.freq === 'WEEKLY') {
    expanded = expandWeekly(event, rule, expandOptions, durationMs || DAY_MS);
  } else if (rule.freq === 'MONTHLY') {
    expanded = expandMonthly(event, rule, expandOptions, durationMs || DAY_MS);
  }
  if (!expanded || !expanded.length) return null;
  return expanded;
}

export function expandRecurringEvents(events = [], options = {}) {
  const mergedOptions = {
    horizonDays: Math.max(1, Number(options.horizonDays) || 365),
    maxOccurrences: Math.max(1, Number(options.maxOccurrences) || 400),
    maxIterations: Math.max(1, Number(options.maxIterations) || 1000),
  };
  const out = [];
  for (const ev of (events || [])) {
    if (!ev || typeof ev !== 'object') continue;
    const expanded = expandSingleRecurringEvent(ev, mergedOptions);
    if (expanded && expanded.length) {
      out.push(...expanded);
    } else {
      const clone = { ...ev };
      if (clone.rrule) clone.rrule = undefined;
      if (clone.recurrence) clone.recurrence = undefined;
      if (clone.rawICS && typeof clone.rawICS === 'string' && /RRULE/i.test(clone.rawICS)) clone.rawICS = undefined;
      out.push(clone);
    }
  }
  return out;
}

export function buildICSCalendar(events, options = {}) {
  const { calendarName = FALLBACK_CALENDAR_NAME, prodId = DEFAULT_PRODID, timeZone = 'UTC' } = options;
  const normalized = normalizeCalendarEvents(events);
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    `X-WR-CALNAME:${escapeICSText(calendarName)}`,
    `X-WR-TIMEZONE:${escapeICSText(timeZone)}`,
  ];
  for (const ev of normalized) {
    const start = ev.startTime instanceof Date ? ev.startTime : coerceToDate(ev.startTime);
    const end = ev.endTime instanceof Date ? ev.endTime : coerceToDate(ev.endTime);
    if (!(start instanceof Date) || isNaN(start) || !(end instanceof Date) || isNaN(end)) continue;
    const uid = ev.uid || ev.id || `evt-${Math.random().toString(36).slice(2)}`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${isoToICSTime(now)}`);
    // All-day events should use DATE format per RFC5545 (VALUE=DATE)
    if(ev.allDay){
      const fmtDate = (d)=> d.toISOString().split('T')[0].replace(/-/g,'');
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(start)}`);
      // For all-day, DTEND is non-inclusive next day; adjust if same day
      const endAdj = (end.getHours()===0 && end.getMinutes()===0 && end.getSeconds()===0) ? end : new Date(end.getTime());
      lines.push(`DTEND;VALUE=DATE:${fmtDate(endAdj)}`);
    } else {
      lines.push(`DTSTART:${isoToICSTime(start)}`);
      lines.push(`DTEND:${isoToICSTime(end)}`);
    }
    lines.push(`SUMMARY:${escapeICSText(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${escapeICSText(ev.location)}`);
    if (ev.status) lines.push(`STATUS:${escapeICSText(ev.status)}`);
    if (ev.transp) lines.push(`TRANSP:${escapeICSText(ev.transp)}`);
    if (ev.rrule) lines.push(`RRULE:${String(ev.rrule).trim()}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeICSText(ev.description)}`);
    if (Array.isArray(ev.categories) && ev.categories.length){
      lines.push(`CATEGORIES:${ev.categories.map(c=>escapeICSText(c)).join(',')}`);
    }
    if (Array.isArray(ev.alarms)){
      for(const al of ev.alarms){
        const mins = Number(al.minutesBefore);
        if(!Number.isFinite(mins) || mins<=0) continue;
        lines.push('BEGIN:VALARM');
        lines.push(`TRIGGER:-PT${Math.floor(mins)}M`);
        lines.push('ACTION:DISPLAY');
        if(al.description) lines.push(`DESCRIPTION:${escapeICSText(al.description)}`); else lines.push('DESCRIPTION:Reminder');
        lines.push('END:VALARM');
      }
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function ensureCalendarPayload(payload = {}, options = {}) {
  let events = Array.isArray(payload.events) ? payload.events : [];
  const rawIcsText = payload.rawIcsText || payload.originalIcsText || null;
  let icsText = typeof payload.icsText === 'string' ? payload.icsText : '';
  if ((!events || !events.length) && icsText) {
    events = parseICS(icsText);
  }
  const normalized = normalizeCalendarEvents(events);
  let resultIcs = icsText;
  const calendarName = payload.calendarName || options.calendarName || undefined;
  if (!resultIcs && normalized.length) {
    resultIcs = buildICSCalendar(normalized, { ...options, calendarName });
  }
  const result = { events: normalized, icsText: resultIcs };
  if (calendarName) result.calendarName = calendarName;
  if (rawIcsText) result.rawIcsText = rawIcsText;
  return result;
}

// Removed dev-time config/dev.json loader to eliminate packaging dependency.
