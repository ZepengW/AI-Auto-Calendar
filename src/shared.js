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

export function parseLLMTime(s) {
  if (!s) return null;
  const match = s.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})/);
  if (!match) return null;
  const [_, y, m, d, H, M, S, tz] = match; // eslint-disable-line no-unused-vars
  return new Date(`${y}-${m}-${d}T${H}:${M}:${S}${tz}`);
}

export function escapeICSText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/, /g, ',')
    .replace(/;/g, '\\;');
}
