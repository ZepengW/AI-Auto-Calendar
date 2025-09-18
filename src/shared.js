// Shared constants & helpers (extracted from userscript)
// ----------------------------------------------------
// DEFAULTS: unified default configuration for storage fallbacks
export const DEFAULTS = {
  radicalBase: 'http://127.0.0.1:5232',
  radicalUsername: 'user',
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
  // Google defaults (dev time). For production prefer Chrome Identity manifest oauth2.
  googleClientId: '',
  googleCalendarId: 'primary',
  // 页面解析（fetch 策略下）JSON 直取配置
  pageParseJsonMode: 'llm', // 'llm' | 'json'  -> json 表示直接按路径提取事件，不调用 LLM
  // 多行 JSON 路径，示例： data.events[*]\n data.schoolCalendar.events[*]
  // 语法： path = seg(.seg)*  seg = key | key[index] | key[*] | [index] | [*]
  // key: /^[A-Za-z0-9_]+$/; index: 数字
  pageParseJsonPaths: 'data.events[*]',
};

// Pages where calendar features are active
export const allowedPages = ['my.sjtu.edu.cn/ui/calendar'];

// Storage helpers
export function getStorageArea() {
  return chrome?.storage?.local;
}

export async function loadSettings() {
  const area = getStorageArea();
  const data = await area.get(null);
  const devCfg = await loadPackagedConfig();
  return { ...DEFAULTS, ...(devCfg||{}), ...data };
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

// Try load packaged dev config config/dev.json (optional)
let _cachedDevConfig = undefined;
export async function loadPackagedConfig(){
  if(_cachedDevConfig !== undefined) return _cachedDevConfig;
  try{
    const url = chrome.runtime.getURL('config/dev.json');
    const res = await fetch(url);
    if(!res.ok) { _cachedDevConfig = null; return null; }
    const json = await res.json();
    _cachedDevConfig = json && typeof json === 'object' ? json : null;
    return _cachedDevConfig;
  } catch{ _cachedDevConfig = null; return null; }
}
