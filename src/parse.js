import { loadSettings, DEFAULTS, parseLLMTime, ensureCalendarPayload } from './shared.js';

function qs(id){ return document.getElementById(id); }
function ce(tag, props={}){ const el=document.createElement(tag); Object.assign(el, props); return el; }

function setStatus(txt){ const s=qs('parseStatus'); if(s) s.textContent = txt || ''; }
function setUploadStatus(html, cls){ const box=qs('uploadStatus'); if(!box) return; box.innerHTML = html || ''; box.className = cls||''; }
function showMessage(html, type='info'){ const box=qs('messageBox'); if(!box) return; box.style.display='block'; box.innerHTML = `<div class="${type==='error'?'error-box':'success-box'}">${html}</div>`; setTimeout(()=>{box.style.display='none';}, 8000); }

let currentPayload = { events: [], icsText: '', calendarName: '' };
let currentEvents = [];
let jsonMode = false; // 当为 true 时，rawInput 直接被当作 JSON 解析
let settingsCache = null;
let parsersCache = [];
let serversCache = [];
const FALLBACK_CALENDAR_NAME = 'AI-Auto-Calendar';

function applyPayload(payload, fallbackName){
  const options = {};
  const fallback = resolveCalendarName(fallbackName);
  if(fallback) options.calendarName = fallback;
  const prevRaw = currentPayload?.rawIcsText;
  currentPayload = ensureCalendarPayload(payload || {}, options);
  if(!currentPayload.rawIcsText && (payload?.rawIcsText || prevRaw)){
    currentPayload.rawIcsText = payload?.rawIcsText || prevRaw;
  }
  if(!currentPayload.calendarName && options.calendarName) currentPayload.calendarName = options.calendarName;
  currentEvents = currentPayload.events;
}

function markPayloadDirty(){
  if(currentPayload) currentPayload.icsText = '';
}

function getServerById(id){
  if(!id) return null;
  return serversCache.find(s => s.id === id) || null;
}

function getDefaultServer(list = serversCache){
  if(!Array.isArray(list) || !list.length) return null;
  const target = settingsCache?.selectedServerId;
  if(target){
    const found = list.find(s => s.id === target);
    if(found) return found;
  }
  return list[0] || null;
}

function getDefaultParserId(list = parsersCache){
  if(!Array.isArray(list) || !list.length) return '';
  const target = settingsCache?.selectedParserId;
  if(target && list.some(p => p.id === target)) return target;
  return list[0]?.id || '';
}

function getActiveServer(){
  const sel = qs('serverSelect');
  const currentId = (sel?.value || '').trim();
  if(currentId){
    return getServerById(currentId) || null;
  }
  return getDefaultServer();
}

function resolveCalendarName(preferred){
  const trimmed = typeof preferred === 'string' ? preferred.trim() : '';
  if(trimmed) return trimmed;
  const server = getActiveServer();
  const serverDefault = typeof server?.config?.defaultCalendarName === 'string'
    ? server.config.defaultCalendarName.trim()
    : '';
  if(serverDefault) return serverDefault;
  return FALLBACK_CALENDAR_NAME;
}

function updateCalendarPlaceholder(){
  const input = qs('calendarNameInput');
  if(!input) return;
  const server = getActiveServer();
  const defaultName = typeof server?.config?.defaultCalendarName === 'string'
    ? server.config.defaultCalendarName.trim()
    : '';
  input.placeholder = defaultName ? `留空默认：${defaultName}` : `留空默认：${FALLBACK_CALENDAR_NAME}`;
}

function buildEventIcsSnippet(event){
  if(!event) return '';
  const rawIcs = event.rawICS || event.raw?.rawICS;
  if(rawIcs) return rawIcs;
  const payloadRaw = currentPayload?.rawIcsText;
  if(payloadRaw && event.title){
    const escaped = event.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`BEGIN:VEVENT[\\s\\S]*?SUMMARY:${escaped}[\\s\\S]*?END:VEVENT`, 'i');
    const matchRaw = payloadRaw.match(regex);
    if(matchRaw) return matchRaw[0];
  }
    const name = resolveCalendarName(currentPayload?.calendarName);
    const payload = ensureCalendarPayload({ events: [event] }, { calendarName: name });
  const text = payload?.icsText || '';
  if(!text) return '';
  const match = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/);
  return match ? match[0] : text;
}

function setJsonMode(on){
  jsonMode = !!on;
  const sel = qs('parserSelect');
  if(sel){ sel.disabled = jsonMode; sel.title = jsonMode? 'JSON 模式下不调用解析节点':''; }
  const area = qs('rawInput');
  if(area){
    area.placeholder = jsonMode ? '请输入 JSON，格式如 {"events":[{"title":"...","startTime":"...","endTime":"...","location":"...","description":"..."}]}' : '在此粘贴或输入要解析的文本，可多行';
  }
}

function normalizeJsonEvents(obj){
  // 支持两种输入：
  // 1) 顶层 { events: [...] }
  // 2) 直接是事件数组 [...]
  let list = [];
  if(Array.isArray(obj)) list = obj; else if(obj && Array.isArray(obj.events)) list = obj.events; else return [];
  // 映射到内部统一结构；保留原始字段在 raw 中便于查看
  return list.map(ev => ({
    ...ev,
    title: ev.title || ev.summary || ev.name || '',
    startTime: parseLLMTime(ev.startTime) || parseLLMTime(ev.start_time) || ev.startTime || ev.start_time || '',
    endTime: parseLLMTime(ev.endTime) || parseLLMTime(ev.end_time) || ev.endTime || ev.end_time || '',
    location: ev.location || ev.place || '',
    description: ev.description,
    startTimeRaw: ev.startTime || ev.start_time,
    endTimeRaw: ev.endTime || ev.end_time,
    raw: ev
  })).filter(e => e.title && e.startTime && e.endTime);
}

async function parseJson(raw){
  const text = String(raw||'').trim();
  if(!text){ showMessage('请输入 JSON','error'); return; }
  let obj;
  try { obj = JSON.parse(text); } catch(e){ showMessage('JSON 解析失败：'+ e.message,'error'); return; }
  const events = normalizeJsonEvents(obj);
  applyPayload({ events, calendarName: 'JSON-Manual' }, 'JSON-Manual');
  renderEvents();
  showMessage('JSON 解析成功，共 '+currentEvents.length+' 条','success');
}

async function parseLLM(raw){
  const text = raw.trim();
  if(!text){ showMessage('请输入文本','error'); return; }
  setStatus('解析中…');
  qs('btnParse').disabled = true;
  try {
    if(jsonMode){
      await parseJson(text);
    } else {
      const parserId = (qs('parserSelect')?.value || '').trim();
      let resp;
      if(parserId){
        resp = await chrome.runtime.sendMessage({ type:'PARSE_TEXT_WITH_PARSER', parserId, text });
      } else {
        resp = await chrome.runtime.sendMessage({ type:'PARSE_LLM_ONLY', text });
      }
      if(!resp?.ok) throw new Error(resp?.error || '解析失败');
      applyPayload(resp.payload, resp.payload?.calendarName);
      renderEvents();
      showMessage('解析成功，共 '+currentEvents.length+' 条','success');
    }
  } catch(e){
    showMessage('解析失败：'+ e.message, 'error');
  } finally {
    qs('btnParse').disabled = false;
    setStatus('');
  }
}

function renderEvents(){
  const sec = qs('resultSection');
  const table = qs('eventsTable');
  if(!sec || !table) return;
  const tbody = table.querySelector('tbody');
  if(!tbody) return;
  tbody.innerHTML='';
  const countBadge = qs('resultCount'); if(countBadge) countBadge.textContent = String(currentEvents.length);
  if(!currentEvents.length){
    sec.style.display='none';
    updateUploadButton();
    return;
  }
  sec.style.display='block';
  const toLocalInput = (v)=>{
    const d = (v instanceof Date) ? v : (v ? new Date(v) : null);
    if(!d || isNaN(d.getTime())) return '';
    const pad = (n)=> String(n).padStart(2,'0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth()+1);
    const dd = pad(d.getDate());
    const HH = pad(d.getHours());
    const MM = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${HH}:${MM}`;
  };
  currentEvents.forEach((ev, idx)=>{
    const tr = ce('tr');
    tr.innerHTML = `
      <td class="select-col"><input type="checkbox" class="rowChk" data-idx="${idx}" checked></td>
      <td><input class="ed-title" data-idx="${idx}" value="${escapeHtml(ev.title||'')}" style="width:160px"></td>
      <td><input type="datetime-local" class="ed-start" data-idx="${idx}" value="${escapeHtml(toLocalInput(ev.startTime||ev.startTimeRaw))}" style="width:180px"></td>
      <td><input type="datetime-local" class="ed-end" data-idx="${idx}" value="${escapeHtml(toLocalInput(ev.endTime||ev.endTimeRaw))}" style="width:180px"></td>
      <td><input class="ed-loc" data-idx="${idx}" value="${escapeHtml(ev.location||'')}" style="width:140px"></td>
      <td><input class="ed-desc" data-idx="${idx}" value="${escapeHtml(ev.description||'')}" style="width:200px"></td>
      <td><button class="btn-view-json btn-mini" data-idx="${idx}">查看 ICS</button></td>`;
    tbody.appendChild(tr);
  });
  updateUploadButton();
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (s)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[s]));
}

function collectSelected(){
  const chks = [...document.querySelectorAll('.rowChk')];
  return chks.filter(c=>c.checked).map(c=>Number(c.dataset.idx));
}

function updateUploadButton(){
  const sel = collectSelected();
  const btn = qs('btnUpload'); if(btn) btn.disabled = !sel.length;
  const btnD = qs('btnDownloadSelected'); if(btnD) btnD.disabled = !sel.length;
}

function attachTableEvents(){
  document.addEventListener('change', (e)=>{
    const t = e.target;
    if(t.id === 'chkAll'){
      document.querySelectorAll('.rowChk').forEach(c=>{ c.checked = t.checked; });
      updateUploadButton();
      return;
    }
    if(t.classList?.contains?.('rowChk')){
      updateUploadButton();
      return;
    }
    const idx = Number(t.dataset?.idx);
    if(Number.isNaN(idx) || !currentEvents[idx]) return;
    let dirty = false;
    if(t.classList.contains('ed-title')){ currentEvents[idx].title = t.value.trim(); dirty = true; }
    if(t.classList.contains('ed-loc')){ currentEvents[idx].location = t.value.trim(); dirty = true; }
    if(t.classList.contains('ed-desc')){ currentEvents[idx].description = t.value; dirty = true; }
    if(t.classList.contains('ed-start')){
      const s = String(t.value||'').trim();
      currentEvents[idx].startTime = s ? new Date(s) : null;
      dirty = true;
    }
    if(t.classList.contains('ed-end')){
      const s = String(t.value||'').trim();
      currentEvents[idx].endTime = s ? new Date(s) : null;
      dirty = true;
    }
    if(dirty) markPayloadDirty();
  });
  document.addEventListener('click', (e)=>{
    const t = e.target;
    if(t.classList?.contains?.('btn-view-json')){
      const i = Number(t.dataset.idx);
      const data = currentEvents[i] || {};
      const modal = qs('rawModal');
      const pre = qs('rawContent');
      if(modal && pre){
        const snippet = buildEventIcsSnippet(data);
        pre.textContent = snippet || '（无可用 ICS 内容）';
        modal.style.display='flex';
      }
      return;
    }
    if(t.id === 'rawClose'){
      const modal = qs('rawModal'); if(modal) modal.style.display='none';
      return;
    }
    if(t.id === 'rawCopy'){
      const pre = qs('rawContent');
      try { navigator.clipboard.writeText(pre?.textContent||''); } catch(_){ /* ignore */ }
    }
  });
}

async function loadParsersList(){
  let list = [];
  try {
    const r = await chrome.runtime.sendMessage({ type:'GET_PARSERS' });
    list = r?.ok ? (r.parsers||[]) : [];
  } catch(e){
    console.warn('加载解析节点失败', e);
  }
  parsersCache = Array.isArray(list) ? list : [];
  const sel = qs('parserSelect');
  if(!sel) return;
  sel.innerHTML='';
  const defaultId = getDefaultParserId(parsersCache);
  if(!parsersCache.length){
    sel.disabled = true;
    const placeholder = document.createElement('option');
    placeholder.value='';
    placeholder.textContent='暂无解析节点';
    sel.appendChild(placeholder);
    sel.value='';
    return;
  }
  sel.disabled = false;
  for(const p of parsersCache){
    const option = document.createElement('option');
    option.value = p.id;
    const base = p.type ? `${p.name}（${p.type}）` : p.name;
    option.textContent = defaultId && p.id === defaultId ? `${base}（默认）` : base;
    sel.appendChild(option);
  }
  const firstId = parsersCache[0]?.id || '';
  sel.value = defaultId || firstId;
}

async function loadServersList(){
  let list = [];
  try {
    const r = await chrome.runtime.sendMessage({ type:'GET_SERVERS' });
    list = r?.ok ? (r.servers||[]) : [];
  } catch(e){
    console.warn('加载上传服务器失败', e);
  }
  serversCache = Array.isArray(list) ? list : [];
  const sel = qs('serverSelect');
  if(!sel) return;
  sel.innerHTML='';
  const defaultServer = getDefaultServer(serversCache);
  if(!serversCache.length){
    sel.disabled = true;
    const placeholder = document.createElement('option');
    placeholder.value='';
    placeholder.textContent='暂无上传服务器';
    sel.appendChild(placeholder);
    sel.value='';
    updateCalendarPlaceholder();
    return;
  }
  sel.disabled = false;
  for(const s of serversCache){
    const option = document.createElement('option');
    option.value = s.id;
    const base = s.type ? `${s.name}（${s.type}）` : s.name;
    option.textContent = defaultServer && s.id === defaultServer.id ? `${base}（默认）` : base;
    sel.appendChild(option);
  }
  const firstId = serversCache[0]?.id || '';
  sel.value = defaultServer?.id || firstId;
  updateCalendarPlaceholder();
}

async function uploadSelected(){
  setUploadStatus('上传中…','');
  const idxs = collectSelected();
  if(!idxs.length){ setUploadStatus('未选择事件','error-box'); return; }
  try {
    const picked = idxs.map(i => currentEvents[i]);
    const toDate = (v)=>{
      if(v instanceof Date) return v;
      const llm = parseLLMTime(v); if(llm instanceof Date) return llm;
      const s = (v==null? '' : String(v)).trim();
      if(!s) return null;
      const d = new Date(s);
      return isNaN(d?.getTime?.()) ? null : d;
    };
    const normalized = picked.map(ev=>{
      const s = toDate(ev.startTime || ev.startTimeRaw);
      const e = toDate(ev.endTime || ev.endTimeRaw);
      return { ...ev, startTime: s || ev.startTime || ev.startTimeRaw, endTime: e || ev.endTime || ev.endTimeRaw };
    });
    let serverId = (qs('serverSelect')?.value || '').trim();
    let targetServer = serverId ? getServerById(serverId) : null;
    if(!targetServer){
      targetServer = getDefaultServer();
    }
    if(!serverId && targetServer){
      serverId = targetServer.id;
    }
    const inputCalendarName = (qs('calendarNameInput')?.value || '').trim();
    const calendarName = resolveCalendarName(inputCalendarName || currentPayload.calendarName);
    const payload = ensureCalendarPayload({ events: normalized }, { calendarName });
    const res = await chrome.runtime.sendMessage({ type:'UPLOAD_EVENTS', payload, serverId: serverId || undefined, calendarName: payload.calendarName });
    if(!res?.ok) throw new Error(res?.error || '上传失败');
    applyPayload(payload, payload.calendarName);
    setUploadStatus('上传成功：'+ payload.events.length +' 条','success-box');
  } catch(e){
    setUploadStatus('上传失败：'+ e.message,'error-box');
  }
}

function downloadText(filename, text){
  const blob = new Blob([text], { type:'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display='none';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
}

async function parseAndDownload(){
  try{
    const raw = (qs('rawInput')?.value||'').trim();
    if(!raw){ showMessage('请输入文本','error'); return; }
    await parseLLM(raw);
    const idxs = collectSelected();
    const picked = idxs.length ? idxs.map(i=> currentEvents[i]) : currentEvents.slice();
    if(!picked.length){ showMessage('没有可下载的事件','error'); return; }
    const calendarName = resolveCalendarName(currentPayload.calendarName);
    const payload = ensureCalendarPayload({ events: picked }, { calendarName });
    downloadText(`${payload.calendarName}.ics`, payload.icsText);
    showMessage('已生成并下载 ICS','success');
  }catch(e){ showMessage('解析或下载失败: ' + e.message, 'error'); }
}

function downloadSelected(){
  const idxs = collectSelected();
  if(!idxs.length){ setUploadStatus('未选择事件','error-box'); return; }
  const picked = idxs.map(i=> currentEvents[i]);
  const calendarName = resolveCalendarName(currentPayload.calendarName);
  const payload = ensureCalendarPayload({ events: picked }, { calendarName });
  downloadText(`${payload.calendarName}-selected.ics`, payload.icsText);
}

async function init(){
  const btnParse = qs('btnParse'); if(btnParse) btnParse.addEventListener('click', ()=>parseLLM(qs('rawInput').value));
  const btnParseDownload = qs('btnParseDownload'); if(btnParseDownload) btnParseDownload.addEventListener('click', parseAndDownload);
  const btnClear = qs('btnClear'); if(btnClear) btnClear.addEventListener('click', ()=>{ const area = qs('rawInput'); if(area) area.value=''; setStatus(''); });
  const btnMock = qs('btnMock');
  if(btnMock){
    btnMock.addEventListener('click', ()=>{
      const area = qs('rawInput');
      if(area){
        area.value = `明天下午3点-5点在软件学院220会议室开AI项目评审会；
9月18日全天 外聘专家对接；
本周三开始，每个周三的下午4点到5点开组会，共四周。`;
      }
    });
  }
  const btnUpload = qs('btnUpload'); if(btnUpload) btnUpload.addEventListener('click', uploadSelected);
  const btnDownloadSelected = qs('btnDownloadSelected'); if(btnDownloadSelected) btnDownloadSelected.addEventListener('click', downloadSelected);
  const btnSelectAll = qs('btnSelectAll'); if(btnSelectAll) btnSelectAll.addEventListener('click', ()=>{ document.querySelectorAll('.rowChk').forEach(c=>c.checked=true); updateUploadButton(); });
  const btnInvert = qs('btnInvert'); if(btnInvert) btnInvert.addEventListener('click', ()=>{ document.querySelectorAll('.rowChk').forEach(c=>c.checked=!c.checked); updateUploadButton(); });
  const btnOptions = qs('openOptions'); if(btnOptions) btnOptions.addEventListener('click', ()=>{ chrome.runtime.openOptionsPage ? chrome.runtime.openOptionsPage() : window.open('options.html'); });

  attachTableEvents();
  document.addEventListener('keydown', (e)=>{
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='enter'){ parseLLM(qs('rawInput').value); }
  });

  const jsonToggle = qs('jsonModeToggle');
  if(jsonToggle){
    jsonToggle.addEventListener('change', ()=> setJsonMode(jsonToggle.checked));
    setJsonMode(jsonToggle.checked);
  } else {
    setJsonMode(false);
  }

  try {
    const hash = location.hash || '';
    if(hash.startsWith('#text=')){
      const txt = decodeURIComponent(hash.slice('#text='.length));
      if(txt){ const area = qs('rawInput'); if(area) area.value = txt; }
    }
  } catch(_){ /* ignore */ }

  updateUploadButton();
  updateCalendarPlaceholder();

  try {
    settingsCache = await loadSettings();
  } catch(e){
    console.warn('加载设置失败', e);
    settingsCache = { ...DEFAULTS };
  }

  await Promise.all([loadParsersList(), loadServersList()]);

  const serverSelect = qs('serverSelect');
  if(serverSelect){
    serverSelect.addEventListener('change', updateCalendarPlaceholder);
  }
  updateCalendarPlaceholder();
}

init().catch(err => console.error('解析页面初始化失败', err));
