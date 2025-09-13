import { loadSettings, DEFAULTS, parseLLMTime, isoToICSTime, escapeICSText } from './shared.js';

function qs(id){ return document.getElementById(id); }
function ce(tag, props={}){ const el=document.createElement(tag); Object.assign(el, props); return el; }

function setStatus(txt){ const s=qs('parseStatus'); if(s) s.textContent = txt || ''; }
function setUploadStatus(html, cls){ const box=qs('uploadStatus'); if(!box) return; box.innerHTML = html || ''; box.className = cls||''; }
function showMessage(html, type='info'){ const box=qs('messageBox'); if(!box) return; box.style.display='block'; box.innerHTML = `<div class="${type==='error'?'error-box':'success-box'}">${html}</div>`; setTimeout(()=>{box.style.display='none';}, 8000); }

let currentEvents = [];

async function parseLLM(raw){
  const text = raw.trim();
  if(!text){ showMessage('请输入文本','error'); return; }
  setStatus('解析中…');
  qs('btnParse').disabled = true;
  try {
    const parserId = (qs('parserSelect')?.value || '').trim();
    let res;
    if(parserId){
      const r = await chrome.runtime.sendMessage({ type:'PARSE_TEXT_WITH_PARSER', parserId, text });
      if(!r?.ok) throw new Error(r?.error||'解析失败');
      res = { ok:true, events: r.events };
    } else {
      res = await chrome.runtime.sendMessage({ type:'PARSE_LLM_ONLY', text });
    }
    if(!res?.ok) throw new Error(res?.error || '解析失败');
    currentEvents = res.events || [];
    renderEvents();
    showMessage('解析成功，共 '+currentEvents.length+' 条','success');
  } catch(e){
    showMessage('解析失败：'+ e.message, 'error');
  } finally {
    qs('btnParse').disabled = false;
    setStatus('');
  }
}

function renderEvents(){
  const sec = qs('resultSection');
  const tbody = qs('eventsTable').querySelector('tbody');
  tbody.innerHTML='';
  qs('resultCount').textContent = currentEvents.length;
  if(!currentEvents.length){ sec.style.display='none'; return; }
  sec.style.display='block';
  currentEvents.forEach((ev, idx) => {
    const tr = ce('tr');
    tr.innerHTML = `
      <td class="select-col"><input type="checkbox" class="rowChk" data-idx="${idx}" checked></td>
      <td><input class="ed-title" data-idx="${idx}" value="${escapeHtml(ev.title||'')}" style="width:160px"></td>
      <td><input class="ed-start" data-idx="${idx}" value="${escapeHtml(ev.startTimeRaw||ev.startTime||'')}" style="width:150px"></td>
      <td><input class="ed-end" data-idx="${idx}" value="${escapeHtml(ev.endTimeRaw||ev.endTime||'')}" style="width:150px"></td>
      <td><input class="ed-loc" data-idx="${idx}" value="${escapeHtml(ev.location||'')}" style="width:140px"></td>
      <td><code style="font-size:11px;white-space:pre-wrap;word-break:break-all">${escapeHtml(JSON.stringify(ev))}</code></td>`;
    tbody.appendChild(tr);
  });
  updateUploadButton();
}

function escapeHtml(str){ return String(str).replace(/[&<>"']/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[s])); }

function collectSelected(){
  const chks = [...document.querySelectorAll('.rowChk')];
  return chks.filter(c=>c.checked).map(c=>Number(c.dataset.idx));
}
function updateUploadButton(){
  const sel = collectSelected();
  const btn = qs('btnUpload');
  if(btn) btn.disabled = !sel.length;
  const btnD = qs('btnDownloadSelected'); if(btnD) btnD.disabled = !sel.length;
}

function attachTableEvents(){
  document.addEventListener('change', (e)=>{
    const t = e.target;
    if(t.classList.contains('rowChk')) updateUploadButton();
    if(t.id==='chkAll'){
      document.querySelectorAll('.rowChk').forEach(c=>{ c.checked = t.checked; });
      updateUploadButton();
    }
    if(t.classList.contains('ed-title')) currentEvents[t.dataset.idx].title = t.value.trim();
    if(t.classList.contains('ed-loc')) currentEvents[t.dataset.idx].location = t.value.trim();
    if(t.classList.contains('ed-start')) currentEvents[t.dataset.idx].startTime = t.value.trim();
    if(t.classList.contains('ed-end')) currentEvents[t.dataset.idx].endTime = t.value.trim();
  });
}

async function uploadSelected(){
  setUploadStatus('上传中…','');
  const idxs = collectSelected();
  if(!idxs.length){ setUploadStatus('未选择事件','error-box'); return; }
  try {
    const picked = idxs.map(i => currentEvents[i]);
    // 预处理时间
    const normalized = picked.map(ev=>({
      ...ev,
      startTime: parseLLMTime(ev.startTime),
      endTime: parseLLMTime(ev.endTime)
    }));
    const serverId = (qs('serverSelect')?.value || '').trim();
    const res = await chrome.runtime.sendMessage({ type:'UPLOAD_EVENTS', events: normalized, serverId: serverId || undefined });
    if(!res?.ok) throw new Error(res?.error || '上传失败');
    setUploadStatus('上传成功：'+ normalized.length +' 条','success-box');
  } catch(e){
    setUploadStatus('上传失败：'+ e.message,'error-box');
  }
}

// ---- Download helpers (ICS) ----
function buildICS(events, calendarName='LLM-Parsed'){
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
      const s = parseLLMTime(ev.startTime) || parseLLMTime(ev.startTimeRaw) || ev.startTime || ev.startTimeRaw;
      const e = parseLLMTime(ev.endTime) || parseLLMTime(ev.endTimeRaw) || ev.endTime || ev.endTimeRaw;
      if(!s || !e || !ev.title) continue;
      const sd = s instanceof Date ? s : new Date(s);
      const ed = e instanceof Date ? e : new Date(e);
      if(!(sd instanceof Date) || isNaN(sd) || !(ed instanceof Date) || isNaN(ed)) continue;
      lines.push('BEGIN:VEVENT');
      const uid = ev.eventId || ev.id || 'evt-' + Math.random().toString(36).slice(2);
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${isoToICSTime(now)}`);
      lines.push(`DTSTART:${isoToICSTime(sd)}`);
      lines.push(`DTEND:${isoToICSTime(ed)}`);
      lines.push(`SUMMARY:${escapeICSText(ev.title)}`);
      if(ev.location) lines.push(`LOCATION:${escapeICSText(ev.location)}`);
      if(ev.description) lines.push(`DESCRIPTION:${escapeICSText(String(ev.description))}`);
      lines.push('END:VEVENT');
    }catch(_){ /* ignore bad row */ }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
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
    await parseLLM(raw); // fills currentEvents & renders
    const idxs = collectSelected();
    const picked = idxs.length ? idxs.map(i=> currentEvents[i]) : currentEvents.slice();
    if(!picked.length){ showMessage('没有可下载的事件','error'); return; }
    const ics = buildICS(picked, 'LLM-Parsed');
    downloadText('LLM-Parsed.ics', ics);
    showMessage('已生成并下载 ICS','success');
  }catch(e){ showMessage('解析或下载失败: ' + e.message, 'error'); }
}

function downloadSelected(){
  const idxs = collectSelected();
  if(!idxs.length){ setUploadStatus('未选择事件','error-box'); return; }
  const picked = idxs.map(i=> currentEvents[i]);
  const ics = buildICS(picked, 'LLM-Parsed');
  downloadText('LLM-Parsed-selected.ics', ics);
}

function bind(){
  qs('btnParse').addEventListener('click', ()=>parseLLM(qs('rawInput').value));
  const bpd = qs('btnParseDownload'); if(bpd) bpd.addEventListener('click', parseAndDownload);
  qs('btnClear').addEventListener('click', ()=>{ qs('rawInput').value=''; setStatus(''); });
  qs('btnMock').addEventListener('click', ()=>{
    qs('rawInput').value = `明天下午3点-5点在软件学院220会议室开AI项目评审会
9月18日全天 外聘专家对接
每周三 9:00-10:00 组会（连续四周）`;
  });
  qs('btnUpload').addEventListener('click', uploadSelected);
  const bds = qs('btnDownloadSelected'); if(bds) bds.addEventListener('click', downloadSelected);
  qs('btnSelectAll').addEventListener('click', ()=>{ document.querySelectorAll('.rowChk').forEach(c=>c.checked=true); updateUploadButton(); });
  qs('btnInvert').addEventListener('click', ()=>{ document.querySelectorAll('.rowChk').forEach(c=>c.checked=!c.checked); updateUploadButton(); });
  qs('openOptions').addEventListener('click', ()=>{ chrome.runtime.openOptionsPage ? chrome.runtime.openOptionsPage() : window.open('options.html'); });
  attachTableEvents();
  document.addEventListener('keydown', (e)=>{
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='enter'){ parseLLM(qs('rawInput').value); }
  });
  // Load parsers
  (async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type:'GET_PARSERS' });
      const list = r?.ok ? (r.parsers||[]) : [];
      const sel = qs('parserSelect');
      if(sel){
        sel.innerHTML = '<option value="">(默认 LLM 设置)</option>';
        for(const p of list){
          const o = document.createElement('option'); o.value=p.id; o.textContent = `${p.name} (${p.type})`;
          sel.appendChild(o);
        }
      }
    } catch(_){ /* ignore */ }
  })();
  // Load servers
  (async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type:'GET_SERVERS' });
      const list = r?.ok ? (r.servers||[]) : [];
      const sel = qs('serverSelect');
      if(sel){
        sel.innerHTML = '<option value="">(默认)</option>';
        for(const s of list){
          const o = document.createElement('option'); o.value=s.id; o.textContent = `${s.name} (${s.type})`;
          sel.appendChild(o);
        }
      }
    } catch(_){ /* ignore */ }
  })();
}

bind();