// Popup script with multi-task management & free text LLM parse + download
import { isoToICSTime, escapeICSText, parseLLMTime } from './shared.js';
function qs(id){ return document.getElementById(id); }

function openOptions(hash){
  const suffix = (hash && typeof hash === 'string') ? hash : '';
  // openOptionsPage cannot pass URL params; use tabs.create when a hash is provided
  if(suffix){ chrome.tabs.create({ url: 'options.html' + suffix }); return; }
  if(chrome.runtime.openOptionsPage){ chrome.runtime.openOptionsPage(); }
  else { chrome.tabs.create({ url: 'options.html' }); }
}


function openParsePage(){ chrome.tabs.create({ url:'parse.html' }); }

function setStatus(t){ const el = qs('status'); if(el) el.textContent = t; }

async function loadTasks(){
  const resp = await chrome.runtime.sendMessage({ type:'GET_PAGE_TASKS' });
  if(!resp?.ok) throw new Error(resp?.error||'GET_PAGE_TASKS 失败');
  return resp.tasks || [];
}

async function saveTasks(tasks){
  const resp = await chrome.runtime.sendMessage({ type:'SAVE_PAGE_TASKS', tasks });
  if(!resp?.ok) throw new Error(resp?.error||'SAVE_PAGE_TASKS 失败');
}

async function runTask(id, btn){
  try {
    if(btn) { btn.disabled = true; btn.textContent='运行中'; }
    const resp = await chrome.runtime.sendMessage({ type:'RUN_PAGE_TASK', id });
    if(!resp?.ok) throw new Error(resp?.error||'运行失败');
    setStatus(`任务执行完成: +${resp.added||0} (总${resp.total||0})`);
  } catch(e){
    setStatus('任务执行失败: '+ e.message);
  } finally {
    if(btn){ btn.disabled=false; btn.textContent='运行'; }
  }
}

function renderTasks(tasks){
  const list = qs('taskList');
  const empty = qs('tasksEmpty');
  if(!list) return;
  list.innerHTML='';
  if(!tasks.length){ if(empty) empty.style.display='block'; return; } else if(empty) empty.style.display='none';
  for(const t of tasks){
    const li = document.createElement('li');
    li.style.border='1px solid #dbe5f0';
    li.style.padding='6px 8px';
    li.style.borderRadius='8px';
    li.style.background='#fdfefe';
    li.style.display='flex';
    li.style.flexDirection='column';
    li.style.gap='4px';
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600">
        <span title="${t.modeConfig?.url || ''}">${escapeHtml(t.name||'未命名')}</span>
        <span style="font-weight:400;color:${t.enabled?'#0b6':'#888'}">${t.enabled?'启用':'停用'}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;font-size:11px;flex-wrap:wrap">
        <span>${t.scheduleType==='interval'? (t.intervalMinutes+'m') : '定时点'}</span>
  <span>${t.modeConfig?.parserId ? 'parser:'+t.modeConfig.parserId : '默认'}</span>
        <span>${escapeHtml(t.calendarName||'')}</span>
      </div>
      <div style="display:flex;gap:6px">
        <button data-act="run" style="flex:1;background:#0b74de;color:#fff;border:none;border-radius:5px;padding:4px 0;font-size:12px;cursor:pointer">运行</button>
        <button data-act="edit" style="flex:1;background:#fff;border:1px solid #c5d3e2;border-radius:5px;padding:4px 0;font-size:12px;cursor:pointer">编辑</button>
        <button data-act="del" style="flex:1;background:#fff;border:1px solid #f19999;color:#c03535;border-radius:5px;padding:4px 0;font-size:12px;cursor:pointer">删除</button>
      </div>`;
    li.querySelector('[data-act=run]').addEventListener('click', (e)=> runTask(t.id, e.currentTarget));
    li.querySelector('[data-act=del]').addEventListener('click', async ()=>{
      const newTasks = tasks.filter(x=> x.id !== t.id);
      await saveTasks(newTasks);
      renderTasks(newTasks);
    });
  li.querySelector('[data-act=edit]')?.addEventListener('click', ()=> openOptions('#editTask=' + encodeURIComponent(t.id)));
    list.appendChild(li);
  }
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); }

function openAddDialog(_tasks){ openOptions('#addTask=1'); }

async function init(){
  qs('openOptions')?.addEventListener('click', openOptions);
  qs('openParsePage')?.addEventListener('click', openParsePage);
  const tasks = await loadTasks();
  renderTasks(tasks);
  qs('addTask')?.addEventListener('click', ()=> openAddDialog());
  qs('parseLLMBtn')?.addEventListener('click', parseFreeText);
  qs('parseLLMDownloadBtn')?.addEventListener('click', parseAndDownloadFreeText);
}

async function parseFreeText(){
  const area = qs('freeText');
  const status = qs('freeTextStatus');
  const raw = (area?.value||'').trim();
  if(!raw){ status.textContent='请输入文本'; return; }
  status.textContent='解析中...';
  try {
    const resp = await chrome.runtime.sendMessage({ type:'PARSE_LLM', text: raw });
    if(!resp?.ok) throw new Error(resp.error||'后台失败');
    status.textContent = `解析+上传完成: 事件 ${resp.count||0} (总${resp.total||0})`;
  } catch(e){
    status.textContent = '失败: '+ e.message;
  }
}

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
      const uid = ev.eventId || ev.id || 'evt-' + Math.random().toString(36).slice(2);
      const linesEv = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${isoToICSTime(now)}`,
        `DTSTART:${isoToICSTime(sd)}`,
        `DTEND:${isoToICSTime(ed)}`,
        `SUMMARY:${escapeICSText(ev.title)}`,
      ];
      if(ev.location) linesEv.push(`LOCATION:${escapeICSText(ev.location)}`);
      if(ev.description) linesEv.push(`DESCRIPTION:${escapeICSText(String(ev.description))}`);
      linesEv.push('END:VEVENT');
      lines.push(...linesEv);
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

async function parseAndDownloadFreeText(){
  const area = qs('freeText');
  const status = qs('freeTextStatus');
  const raw = (area?.value||'').trim();
  if(!raw){ status.textContent='请输入文本'; return; }
  status.textContent='解析中...';
  try{
    const resp = await chrome.runtime.sendMessage({ type:'PARSE_LLM_ONLY', text: raw });
    if(!resp?.ok) throw new Error(resp.error||'后台失败');
    const events = Array.isArray(resp.events) ? resp.events : [];
    if(!events.length){ status.textContent='未解析到事件'; return; }
    const ics = buildICS(events, 'LLM-Parsed');
    downloadText('LLM-Parsed.ics', ics);
    status.textContent = `已下载 ICS，事件 ${events.length}`;
  }catch(e){ status.textContent = '失败: ' + e.message; }
}

document.addEventListener('DOMContentLoaded', init);

