// Popup script with multi-task management & free text LLM parse
function qs(id){ return document.getElementById(id); }

function openOptions(){
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
    const modeParse = t.modeConfig?.parseMode === 'direct' ? 'direct':'llm';
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600">
        <span title="${t.modeConfig?.url || ''}">${escapeHtml(t.name||'未命名')}</span>
        <span style="font-weight:400;color:${t.enabled?'#0b6':'#888'}">${t.enabled?'启用':'停用'}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;font-size:11px;flex-wrap:wrap">
        <span>${t.scheduleType==='interval'? (t.intervalMinutes+'m') : '定时点'}</span>
        <span>${modeParse}</span>
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
  li.querySelector('[data-act=edit]').addEventListener('click', ()=> openEditModal(t, tasks));
    list.appendChild(li);
  }
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); }

// ---------------- Modal Editing (Popup) ----------------
const modal = {
  wrap: null,
  form: null,
  title: null,
  fields: {},
  runBtn: null,
  editingId: null,
  tasksCache: [],
};

function initModalRefs(){
  modal.wrap = qs('popupTaskModal');
  modal.form = qs('popupTaskForm');
  modal.title = qs('popupTaskModalTitle');
  modal.fields.name = qs('p_task_name');
  modal.fields.calendarName = qs('p_task_calendarName');
  modal.fields.interval = qs('p_task_interval');
  modal.fields.useInterval = qs('p_task_useInterval');
  modal.fields.enabled = qs('p_task_enabled');
  modal.fields.url = qs('p_task_url');
  modal.fields.mode = qs('p_task_mode');
  modal.fields.parseMode = qs('p_task_parseMode');
  modal.fields.jsonPaths = qs('p_task_jsonPaths');
  modal.fields.jsonWrap = qs('p_task_jsonPaths_wrap');
  modal.fields.useTimes = qs('p_task_useTimes');
  modal.fields.timesWrap = qs('p_schedule_times_wrap');
  modal.fields.timesList = qs('p_task_times_list');
  modal.fields.timeInput = qs('p_task_time_input');
  modal.fields.timeAdd = qs('p_task_time_add');
  modal.fields.visitTrigger = qs('p_task_visitTrigger');
  modal.fields.visitPatterns = qs('p_task_visitPatterns');
  modal.fields.visitWrap = qs('p_visit_patterns_wrap');
  modal.runBtn = qs('p_taskRunOnce');
  qs('popupCloseTaskModal')?.addEventListener('click', closeEditModal);
  modal.fields.parseMode?.addEventListener('change', updatePopupModalVisibility);
  modal.fields.mode?.addEventListener('change', updatePopupModalVisibility);
  modal.fields.useTimes?.addEventListener('change', updatePopupScheduleVisibility);
  modal.fields.visitTrigger?.addEventListener('change', updateVisitVisibility);
  modal.fields.timeAdd?.addEventListener('click', addPopupTimePoint);
  modal.form?.addEventListener('submit', submitPopupModalForm);
  modal.runBtn?.addEventListener('click', runOncePopupModal);
}

function openEditModal(task, all){
  if(!modal.wrap) initModalRefs();
  modal.tasksCache = all.slice();
  modal.editingId = task.id;
  modal.title.textContent = '编辑任务';
  modal.fields.name.value = task.name||'';
  modal._times = Array.isArray(task.times)? task.times.slice(): [];
  modal.fields.interval.value = task.intervalMinutes || task.interval || 60;
  modal.fields.useInterval.checked = (task.useInterval === true) || (!('useInterval' in task) && (task.scheduleType !== 'times'));
  modal.fields.enabled.value = task.enabled? 'true':'false';
  modal.fields.calendarName.value = task.calendarName || task.name || '';
  modal.fields.url.value = task.modeConfig?.url || task.url || '';
  modal.fields.mode.value = task.mode || 'HTTP_GET_JSON';
  modal.fields.parseMode.value = (task.modeConfig?.parseMode === 'direct') ? 'json':'llm';
  // adjust to use 'direct' instead of legacy 'json'
  if(modal.fields.parseMode.value === 'json') modal.fields.parseMode.value = 'direct';
  modal.fields.jsonPaths.value = task.modeConfig?.jsonPaths || task.jsonPaths || 'data.events[*]';
  modal.fields.useTimes.checked = !!task.useTimes || (task.scheduleType === 'times');
  modal.fields.visitTrigger.checked = !!task.visitTrigger;
  modal.fields.visitPatterns.value = Array.isArray(task.visitPatterns) ? task.visitPatterns.join('\n') : '';
  renderPopupTimes();
  updatePopupScheduleVisibility();
  updateVisitVisibility();
  updatePopupModalVisibility();
  modal.wrap.style.display='flex';
}

function closeEditModal(){ if(modal.wrap) modal.wrap.style.display='none'; modal.editingId=null; }

function updatePopupModalVisibility(){
  // Always show JSON paths: used for direct extraction OR narrowing context before LLM
  if(modal.fields.jsonWrap){ modal.fields.jsonWrap.style.display = 'block'; }
}

function updatePopupScheduleVisibility(){
  const useTimes = !!modal.fields.useTimes?.checked;
  if(modal.fields.timesWrap) modal.fields.timesWrap.style.display = useTimes ? 'flex':'none';
}

function updateVisitVisibility(){
  const enabled = !!modal.fields.visitTrigger?.checked;
  if(modal.fields.visitWrap) modal.fields.visitWrap.style.display = enabled ? 'flex':'none';
}

function renderPopupTimes(){
  if(!modal.fields.timesList) return; modal.fields.timesList.innerHTML='';
  (modal._times||[]).forEach((t,i)=>{
    const chip = document.createElement('span');
    chip.style.cssText='background:#eef4fa;border:1px solid #d0dbe8;padding:4px 8px;border-radius:20px;font-size:11px;display:inline-flex;align-items:center;gap:6px';
    chip.innerHTML = `<span>${t}</span><button data-i="${i}" style="background:transparent;border:none;color:#666;cursor:pointer;font-size:12px">×</button>`;
    chip.querySelector('button').addEventListener('click',()=>{ modal._times.splice(i,1); renderPopupTimes(); });
    modal.fields.timesList.appendChild(chip);
  });
}

function addPopupTimePoint(){
  const v = (modal.fields.timeInput.value||'').trim();
  if(!/^\d{2}:\d{2}$/.test(v)){ alert('格式 HH:mm'); return; }
  modal._times.push(v);
  modal.fields.timeInput.value='';
  renderPopupTimes();
}

async function submitPopupModalForm(e){
  e.preventDefault();
  const tasks = modal.tasksCache;
  const idx = tasks.findIndex(t=> t.id === modal.editingId);
  if(idx === -1) return alert('任务不存在');
  const t = tasks[idx];
  const st = (modal.fields.scheduleTypeRadios.find(r=> r.checked)?.value) || 'interval';
  const updated = {
    ...t,
    name: modal.fields.name.value.trim()||'Untitled',
    calendarName: modal.fields.calendarName.value.trim() || modal.fields.name.value.trim() || 'Untitled',
    enabled: modal.fields.enabled.value === 'true',
    // retain legacy scheduleType for compatibility with stored data
    scheduleType: (modal.fields.useTimes?.checked && !modal.fields.useInterval?.checked) ? 'times' : 'interval',
    useInterval: !!modal.fields.useInterval?.checked,
    intervalMinutes: !!modal.fields.useInterval?.checked ? Math.max(1, Number(modal.fields.interval.value)||60) : undefined,
    useTimes: !!modal.fields.useTimes?.checked,
    times: !!modal.fields.useTimes?.checked ? (modal._times||[]) : [],
    visitTrigger: !!modal.fields.visitTrigger?.checked,
    visitPatterns: (modal.fields.visitPatterns?.value||'').split(/\n+/).map(s=>s.trim()).filter(Boolean),
    mode: modal.fields.mode.value || 'HTTP_GET_JSON',
    modeConfig: {
      url: modal.fields.url.value.trim(),
      jsonPaths: modal.fields.jsonPaths.value.trim(),
      parseMode: (modal.fields.parseMode.value === 'direct') ? 'direct':'llm',
    },
  };
  if(!updated.useTimes) delete updated.times; if(!updated.useInterval) delete updated.intervalMinutes;
  const newTasks = tasks.map(x=> x.id===t.id? updated: x);
  try { await saveTasks(newTasks); renderTasks(newTasks); closeEditModal(); }
  catch(e){ alert('保存失败: '+ e.message); }
}

async function runOncePopupModal(){
  if(!modal.editingId) return;
  try {
    modal.runBtn.disabled=true; modal.runBtn.textContent='运行中';
    const r = await chrome.runtime.sendMessage({ type:'RUN_PAGE_TASK', id: modal.editingId });
    if(!r?.ok) alert('运行失败: '+ (r.error||'未知错误')); else alert('运行完成 +'+(r.added||0));
  } catch(e){
    alert('运行异常: '+ e.message);
  } finally { modal.runBtn.disabled=false; modal.runBtn.textContent='试运行'; }
}

function openAddDialog(tasks){
  // open empty modal for new task creation using new model
  openEditModal({ id: 'task-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6), name:'', intervalMinutes:60, enabled:true, scheduleType:'interval', mode:'HTTP_GET_JSON', modeConfig:{ url:'', jsonPaths:'data.events[*]', parseMode:'llm'}, times:[], calendarName:'' }, tasks);
}

async function init(){
  qs('openOptions')?.addEventListener('click', openOptions);
  qs('openParsePage')?.addEventListener('click', openParsePage);
  const tasks = await loadTasks();
  renderTasks(tasks);
  qs('addTask')?.addEventListener('click', ()=> openAddDialog(tasks.slice()));
  qs('parseLLMBtn')?.addEventListener('click', parseFreeText);
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

document.addEventListener('DOMContentLoaded', init);
