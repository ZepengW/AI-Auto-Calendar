// Options page script (MV3) - moved from inline
import { loadSettings, saveSettings, DEFAULTS } from './shared.js';

const els = {
  radicalBase: null,
  radicalUsername: null,
  radicalAuth: null,
  autoSyncMinutes: null,
  dateWindowDays: null,
  enableNotifications: null,
  llmProvider: null,
  lastSync: null,
  saveBtn: null,
  syncNow: null,
  pageParseUrl: null,
  pageParseInterval: null,
  pageParseCalendarName: null,
  pageParseEnabled: null,
  pageParseRun: null,
  pageParseStatus: null,
};

function qs(id){ return document.getElementById(id); }

function fillProvider(cfg){
  const wrap = qs('providerConfig');
  if(!wrap) return;
  if(cfg.llmProvider === 'zhipu_agent'){
    wrap.innerHTML = `
      <div class="row">
        <label style="flex:1">Agent ID<input id="llmAgentId" type="text" value="${cfg.llmAgentId || ''}"></label>
        <label style="flex:1">API URL<input id="llmApiUrl" type="text" value="${cfg.llmApiUrl || DEFAULTS.llmApiUrl}"></label>
      </div>
      <label>API Key<input id="llmApiKey" type="text" value="${cfg.llmApiKey || ''}"></label>
      <div class="note">使用 智谱 智能体接口 app_id=Agent ID。</div>`;
  } else {
    wrap.innerHTML = '<p>尚未支持该 Provider</p>';
  }
}

async function init(){
  // map elements
  els.radicalBase = qs('radicalBase');
  els.radicalUsername = qs('radicalUsername');
  els.radicalAuth = qs('radicalAuth');
  els.autoSyncMinutes = qs('autoSyncMinutes');
  els.dateWindowDays = qs('dateWindowDays');
  els.enableNotifications = qs('enableNotifications');
  els.llmProvider = qs('llmProvider');
  els.lastSync = qs('lastSync');
  els.saveBtn = qs('save');
  els.syncNow = qs('syncNow');
  // legacy single-task elements (to be removed); keep null-safe usage
  els.pageParseUrl = qs('pageParseUrl');
  els.pageParseInterval = qs('pageParseInterval');
  els.pageParseCalendarName = qs('pageParseCalendarName');
  els.pageParseEnabled = qs('pageParseEnabled');
  els.pageParseRun = qs('pageParseRun');
  els.pageParseStatus = qs('pageParseStatus');
  els.pageParseStrategy = qs('pageParseStrategy');
  els.pageParseJsonPaths = qs('pageParseJsonPaths');
  els.jsonExtractPanel = qs('jsonExtractPanel');
  els.pageParseJsonModeRadios = Array.from(document.querySelectorAll('input[name="pageParseJsonMode"]'));
  // multi task UI
  els.pageTaskList = qs('pageTaskList');
  els.pageTasksEmpty = qs('pageTasksEmpty');
  els.addPageTask = qs('addPageTask');
  // modal fields
  els.taskModal = qs('taskModal');
  els.closeTaskModal = qs('closeTaskModal');
  els.taskForm = qs('taskForm');
  els.taskModalTitle = qs('taskModalTitle');
  els.task_name = qs('task_name');
  els.task_interval = qs('task_interval');
  els.task_useInterval = qs('task_useInterval');
  els.task_calendarName = qs('task_calendarName');
  els.task_enabled = qs('task_enabled');
  els.task_url = qs('task_url');
  els.task_mode = qs('task_mode');
  els.task_parseMode = qs('task_parseMode');
  els.task_jsonPaths = qs('task_jsonPaths');
  els.task_jsonPaths_wrap = qs('task_jsonPaths_wrap');
  // new multi-trigger elements
  els.task_useTimes = qs('task_useTimes');
  els.schedule_times_wrap = qs('schedule_times_wrap');
  els.task_times_list = qs('task_times_list');
  els.task_time_input = qs('task_time_input');
  els.task_time_add = qs('task_time_add');
  els.task_visitTrigger = qs('task_visitTrigger');
  els.visit_patterns_wrap = qs('visit_patterns_wrap');
  els.task_visitPatterns = qs('task_visitPatterns');
  els.taskRunOnce = qs('taskRunOnce');
  els._editingTaskId = null;
  // logs panel elements
  els.logsContainer = qs('logs-container');
  els.refreshLogs = qs('btn-refresh-logs');
  els.clearLogs = qs('btn-clear-logs');
  els.logLimit = qs('log-limit');

  const cfg = await loadSettings(); // after migration background will have moved tasks
  const mapping = {
    radicalBase: 'radicalBase',
    radicalUsername: 'radicalUsername',
    radicalAuth: 'radicalAuth',
    autoSyncMinutes: 'autoSyncMinutes',
    dateWindowDays: 'dateWindowDays',
    enableNotifications: 'enableNotifications',
    llmProvider: 'llmProvider',
    pageParseUrl: 'pageParseUrl',
    pageParseInterval: 'pageParseInterval',
    pageParseCalendarName: 'pageParseCalendarName',
    pageParseEnabled: 'pageParseEnabled',
    pageParseStrategy: 'pageParseStrategy',
    pageParseJsonPaths: 'pageParseJsonPaths',
    pageParseJsonMode: 'pageParseJsonMode',
  };
  Object.entries(mapping).forEach(([k, id]) => {
    const el = els[id];
    if(!el) return;
    if(k === 'enableNotifications') el.value = cfg[k] ? 'true':'false';
    else if(k === 'llmProvider') el.value = cfg.llmProvider || 'zhipu_agent';
    else el.value = cfg[k] ?? DEFAULTS[k];
  });
  if(els.pageParseEnabled) els.pageParseEnabled.value = cfg.pageParseEnabled ? 'true':'false';
  if(els.lastSync) els.lastSync.textContent = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'n/a';
  if(els.pageParseStrategy) els.pageParseStrategy.value = cfg.pageParseStrategy || 'fetch';
  if(els.pageParseJsonPaths) els.pageParseJsonPaths.value = cfg.pageParseJsonPaths || DEFAULTS.pageParseJsonPaths;
  if(els.pageParseJsonModeRadios){
    const mode = cfg.pageParseJsonMode || DEFAULTS.pageParseJsonMode || 'llm';
    els.pageParseJsonModeRadios.forEach(r => r.checked = (r.value === mode));
  }
  updateJsonPanelVisibility();
  fillProvider(cfg);

  els.llmProvider?.addEventListener('change', () => fillProvider({ llmProvider: els.llmProvider.value }));
  els.saveBtn?.addEventListener('click', saveAll);
  els.syncNow?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'SYNC_NOW' }));
  els.pageParseRun?.addEventListener('click', ()=> alert('旧版单任务即将移除，请使用上方多任务')); // deprecate
  els.pageParseStrategy?.addEventListener('change', updateJsonPanelVisibility);
  els.pageParseJsonModeRadios?.forEach(r => r.addEventListener('change', ()=>{}));
  // multi task events
  els.addPageTask?.addEventListener('click', ()=> openTaskModal());
  els.closeTaskModal?.addEventListener('click', closeTaskModal);
  els.taskForm?.addEventListener('submit', submitTaskForm);
  els.task_parseMode?.addEventListener('change', updateTaskModalVisibility);
  els.task_mode?.addEventListener('change', updateTaskModalVisibility);
  els.task_useTimes?.addEventListener('change', updateScheduleModeVisibility);
  els.task_visitTrigger?.addEventListener('change', updateVisitPatternsVisibility);
  els.task_time_add?.addEventListener('click', addTimePoint);
  els.taskRunOnce?.addEventListener('click', tryRunOnceCurrentTask);

  await loadRenderTasks();
  // initial logs load
  await refreshLogs();
  els.refreshLogs?.addEventListener('click', refreshLogs);
  els.clearLogs?.addEventListener('click', clearLogs);
  els.logLimit?.addEventListener('change', refreshLogs);
}

function updateJsonPanelVisibility(){
  if(!els.jsonExtractPanel) return;
  const strat = els.pageParseStrategy?.value || 'fetch';
  els.jsonExtractPanel.style.display = strat === 'fetch' ? 'block':'none';
}

function updateTaskModalVisibility(){
  // JSON 路径现在在两种模式都可用：direct 提取 或 LLM 预裁剪，不再隐藏
  if(els.task_jsonPaths_wrap){ els.task_jsonPaths_wrap.style.display = 'block'; }
}

function updateScheduleModeVisibility(){
  const useTimes = !!els.task_useTimes?.checked;
  if(els.schedule_times_wrap) els.schedule_times_wrap.style.display = useTimes ? 'flex':'none';
}

function updateVisitPatternsVisibility(){
  const enabled = !!els.task_visitTrigger?.checked;
  if(els.visit_patterns_wrap) els.visit_patterns_wrap.style.display = enabled ? 'flex':'none';
}

function renderTimes(times){
  if(!els.task_times_list) return; els.task_times_list.innerHTML='';
  times.forEach((t,i)=>{
    const chip = document.createElement('span');
    chip.style.cssText='background:#eef4fa;border:1px solid #d0dbe8;padding:4px 8px;border-radius:20px;font-size:12px;display:inline-flex;align-items:center;gap:6px';
    chip.innerHTML = `<span>${t}</span><button data-i="${i}" style="background:transparent;border:none;color:#666;cursor:pointer;font-size:12px">×</button>`;
    chip.querySelector('button').addEventListener('click',()=>{
      const arr = (els._editingTimes||[]).slice(); arr.splice(i,1); els._editingTimes=arr; renderTimes(arr);
    });
    els.task_times_list.appendChild(chip);
  });
}

function addTimePoint(){
  const v = (els.task_time_input.value||'').trim();
  if(!/^\d{2}:\d{2}$/.test(v)){ alert('格式 HH:mm'); return; }
  els._editingTimes = [...(els._editingTimes||[]), v];
  els.task_time_input.value='';
  renderTimes(els._editingTimes);
}

async function loadRenderTasks(){
  try {
    const resp = await chrome.runtime.sendMessage({ type:'GET_PAGE_TASKS' });
    if(!resp?.ok) throw new Error(resp.error||'获取任务失败');
    renderTasks(resp.tasks||[]);
  } catch(e){
    console.error('加载任务失败', e);
  }
}

function renderTasks(tasks){
  if(!els.pageTaskList) return;
  els.pageTaskList.innerHTML='';
  if(!tasks.length){ if(els.pageTasksEmpty) els.pageTasksEmpty.style.display='block'; return; }
  if(els.pageTasksEmpty) els.pageTasksEmpty.style.display='none';
  for(const t of tasks){
    const li = document.createElement('li');
    li.style.border='1px solid #d4dbe6';
    li.style.padding='8px 10px';
    li.style.borderRadius='10px';
    li.style.background='#fff';
    li.style.display='flex';
    li.style.flexDirection='column';
    li.style.gap='6px';
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">
        <span title="${escapeHtml(t.modeConfig?.url||'')}">${escapeHtml(t.name||'未命名')}</span>
        <span style="font-size:11px;font-weight:500;color:${t.enabled?'#0b6':'#999'}">${t.enabled?'启用':'停用'}</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#555">
        ${t.useInterval ? `<span>间隔 ${t.intervalMinutes||t.interval||60}m</span>`:''}
        ${(t.useTimes || t.scheduleType==='times') ? `<span>时点 ${Array.isArray(t.times)?t.times.join(', '):''}</span>`:''}
        ${t.visitTrigger ? `<span>访问触发</span>`:''}
      </div>
      <div style="display:flex;gap:8px">
        <button data-act="run" style="flex:1;background:#0b74de;color:#fff;border:none;padding:6px 0;border-radius:6px;font-size:12px;cursor:pointer">运行</button>
        <button data-act="edit" style="flex:1;background:#fff;border:1px solid #c5d3e2;padding:6px 0;border-radius:6px;font-size:12px;cursor:pointer">编辑</button>
        <button data-act="del" style="flex:1;background:#fff;border:1px solid #f0b6b6;color:#c24d4d;padding:6px 0;border-radius:6px;font-size:12px;cursor:pointer">删除</button>
      </div>`;
    li.querySelector('[data-act=run]').addEventListener('click', (e)=> runTask(t.id, e.currentTarget));
    li.querySelector('[data-act=edit]').addEventListener('click', ()=> openTaskModal(t));
    li.querySelector('[data-act=del]').addEventListener('click', async ()=>{
      const tasks2 = tasks.filter(x=> x.id !== t.id);
      await saveTasks(tasks2);
      renderTasks(tasks2);
    });
    els.pageTaskList.appendChild(li);
  }
}

function openTaskModal(task){
  els._editingTaskId = task?.id || null;
  els._editingTimes = Array.isArray(task?.times)? task.times.slice(): [];
  els.taskModalTitle.textContent = task? '编辑任务':'新增任务';
  // new model mapping (fields reuse for now until UI redesign)
  els.task_name.value = task?.name || '';
  els.task_calendarName.value = task?.calendarName || task?.name || '';
  els.task_interval.value = task?.intervalMinutes || task?.interval || 60;
  els.task_enabled.value = task?.enabled? 'true':'false';
  els.task_url.value = task?.modeConfig?.url || task?.url || '';
  els.task_mode.value = 'HTTP_GET_JSON';
  els.task_parseMode.value = (task?.modeConfig?.parseMode === 'direct') ? 'direct':'llm';
  els.task_jsonPaths.value = task?.modeConfig?.jsonPaths || task?.jsonPaths || 'data.events[*]';
  // multi-trigger checkboxes
  if(els.task_useInterval) els.task_useInterval.checked = (task?.useInterval === true) || (!('useInterval' in (task||{})) && (task?.scheduleType !== 'times'));
  if(els.task_useTimes) els.task_useTimes.checked = !!task?.useTimes || (task?.scheduleType === 'times');
  if(els.task_visitTrigger) els.task_visitTrigger.checked = !!task?.visitTrigger;
  if(els.task_visitPatterns) els.task_visitPatterns.value = (Array.isArray(task?.visitPatterns) ? task.visitPatterns.join('\n') : '');
  updateScheduleModeVisibility();
  updateVisitPatternsVisibility();
  renderTimes(els._editingTimes);
  updateTaskModalVisibility();
  els.taskModal.style.display='flex';
}

function closeTaskModal(){
  els.taskModal.style.display='none';
  els._editingTaskId = null;
}

async function submitTaskForm(ev){
  ev.preventDefault();
  const resp = await chrome.runtime.sendMessage({ type:'GET_PAGE_TASKS' });
  const tasks = (resp?.tasks)||[];
  const useInterval = !!els.task_useInterval?.checked;
  const useTimes = !!els.task_useTimes?.checked;
  const visitTrigger = !!els.task_visitTrigger?.checked;
  const visitPatterns = (els.task_visitPatterns?.value || '').split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const data = {
    id: els._editingTaskId || ('task-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6)),
    name: els.task_name.value.trim()||'Untitled',
    calendarName: (els.task_calendarName.value.trim()|| els.task_name.value.trim() || 'Untitled'),
    enabled: els.task_enabled.value === 'true',
  scheduleType: useTimes && !useInterval ? 'times' : 'interval',
  useInterval,
  intervalMinutes: useInterval ? Math.max(1, Number(els.task_interval.value)||60) : undefined,
  useTimes,
  times: useTimes ? (els._editingTimes||[]) : [],
  visitTrigger,
  visitPatterns,
    mode: els.task_mode.value,
    modeConfig: {
      url: els.task_url.value.trim(),
      jsonPaths: els.task_jsonPaths.value.trim(),
      parseMode: (els.task_parseMode.value === 'direct') ? 'direct':'llm',
    },
  };
  if(!useTimes) delete data.times; if(!useInterval) delete data.intervalMinutes;
  const newTasks = els._editingTaskId ? tasks.map(t=> t.id===data.id? data: t) : [...tasks, data];
  await saveTasks(newTasks);
  closeTaskModal();
  renderTasks(newTasks);
}

async function runTask(id, btn){
  try {
    if(btn){ btn.disabled=true; btn.textContent='运行中'; }
    const r = await chrome.runtime.sendMessage({ type:'RUN_PAGE_TASK', id });
    if(!r?.ok) throw new Error(r.error||'执行失败');
  } catch(e){
    alert('执行失败: '+ e.message);
  } finally {
    if(btn){ btn.disabled=false; btn.textContent='运行'; }
  }
}

async function tryRunOnceCurrentTask(){
  if(!els._editingTaskId){ alert('请先保存任务后运行'); return; }
  const btn = els.taskRunOnce;
  try {
    btn.disabled=true; btn.textContent='试运行中';
    const r = await chrome.runtime.sendMessage({ type:'RUN_PAGE_TASK', id: els._editingTaskId });
    if(!r?.ok) alert('试运行失败: '+ (r.error||'未知错误')); else alert('试运行完成: +'+(r.added||0));
  } catch(e){
    alert('试运行异常: '+ e.message);
  } finally { btn.disabled=false; btn.textContent='试运行'; }
}

async function saveTasks(tasks){
  const r = await chrome.runtime.sendMessage({ type:'SAVE_PAGE_TASKS', tasks });
  if(!r?.ok) throw new Error(r.error||'保存任务失败');
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); }

async function saveAll(){
  try {
    const patch = {
      radicalBase: els.radicalBase.value.trim(),
      radicalUsername: els.radicalUsername.value.trim(),
      radicalAuth: els.radicalAuth.value.trim(),
      autoSyncMinutes: Number(els.autoSyncMinutes.value) || DEFAULTS.autoSyncMinutes,
      dateWindowDays: Number(els.dateWindowDays.value) || DEFAULTS.dateWindowDays,
      enableNotifications: els.enableNotifications.value === 'true',
      llmProvider: els.llmProvider.value,
      pageParseUrl: (els.pageParseUrl?.value || '').trim(),
      pageParseInterval: Number(els.pageParseInterval?.value) || 0,
      pageParseCalendarName: (els.pageParseCalendarName?.value || '').trim(),
      pageParseEnabled: els.pageParseEnabled?.value === 'true',
      pageParseStrategy: els.pageParseStrategy?.value || 'fetch',
      pageParseJsonPaths: (els.pageParseJsonPaths?.value || '').trim(),
      pageParseJsonMode: (els.pageParseJsonModeRadios?.find(r=>r.checked)?.value) || 'llm',
    };
    if(patch.llmProvider === 'zhipu_agent'){
      patch.llmAgentId = (qs('llmAgentId')?.value || '').trim();
      patch.llmApiUrl = (qs('llmApiUrl')?.value || '').trim();
      patch.llmApiKey = (qs('llmApiKey')?.value || '').trim();
    }
    // 动态申请 Radicale 服务器权限（避免 CORS 尝试在无 host 权限时失败）
    const originPattern = buildOriginPattern(patch.radicalBase);
    if(originPattern){
      await requestOriginPermission(originPattern);
    }
    await saveSettings(patch);
    alert('已保存' + (originPattern ? ` (已申请权限: ${originPattern})` : ''));
  } catch(e){
    console.error('保存失败', e);
    alert('保存失败: ' + (e.message || e));
  }
}

function buildOriginPattern(url){
  try {
    if(!url) return null;
    const u = new URL(url);
    // 只保留协议 + 主机 + 端口
    return `${u.protocol}//${u.hostname}${u.port?':'+u.port:''}/*`;
  } catch(_){ return null; }
}

async function requestOriginPermission(pattern){
  return new Promise((resolve) => {
    if(!chrome.permissions || !pattern) return resolve(false);
    chrome.permissions.contains({ origins:[pattern] }, (has)=>{
      if(has) return resolve(true);
      chrome.permissions.request({ origins:[pattern] }, (granted)=>{ resolve(granted); });
    });
  });
}

async function runPageParseNow(){
  const url = (els.pageParseUrl?.value || '').trim();
  if(!url){ alert('未配置目标页面 URL'); return; }
  const calendarName = (els.pageParseCalendarName?.value || '').trim() || 'PAGE-PARSED';
  els.pageParseStatus.textContent = '触发中…';
  try {
    const resp = await chrome.runtime.sendMessage({ type:'PAGE_PARSE_RUN_ONCE', url, calendarName });
    if(!resp?.ok) throw new Error(resp?.error || '后台失败');
    els.pageParseStatus.textContent = `已触发：新增 ${resp.added||resp.count||0}`;
  } catch(e){
    els.pageParseStatus.textContent = '失败：'+ e.message;
  }
}

document.addEventListener('DOMContentLoaded', init);

// ---------------- Logs Panel ----------------
async function fetchLogs(limit){
  const n = Math.max(1, Math.min(Number(limit)||200, 1000));
  const r = await chrome.runtime.sendMessage({ type:'GET_TASK_LOGS', limit:n });
  if(!r?.ok) throw new Error(r.error||'获取日志失败');
  return r.logs||[];
}

function renderLogs(logs){
  if(!els.logsContainer) return;
  if(!Array.isArray(logs) || !logs.length){ els.logsContainer.innerHTML = '<div style="color:#666">暂无日志</div>'; return; }
  const fmt = (ts)=> new Date(ts).toLocaleString();
  const esc = (s)=> (s==null?'':String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])));
  const rows = logs.map((it)=>{
    const base = `[${fmt(it.ts)}] [${it.type}] [${it.triggerType||'-'}] [${esc(it.taskName||it.taskId||'-')}]`;
    if(it.type === 'trigger'){
      return `<div>[${fmt(it.ts)}] ▶ 任务触发(${esc(it.triggerType)}) - ${esc(it.taskName||it.taskId)} ${it.info? `<span style="color:#444">${esc(JSON.stringify(it.info))}</span>`:''}</div>`;
    } else if(it.type === 'result'){
      const ok = it.ok === true;
      const color = ok ? '#0b6' : '#c24d4d';
      const tail = ok ? `成功 +${it.added||0} (总${it.total||0}) mode=${esc(it.mode||'-')}` : `失败 ${esc(it.error||'')}`;
      return `<div>[${fmt(it.ts)}] ${ok? '✔':'✖'} <span style="color:${color}">${tail}</span> - ${esc(it.taskName||it.taskId)} <span style="color:#666">${(it.durationMs||0)}ms</span></div>`;
    }
    return `<div>${esc(base)}</div>`;
  });
  els.logsContainer.innerHTML = rows.join('');
}

async function refreshLogs(){
  try{
    const limit = els.logLimit?.value || 200;
    const logs = await fetchLogs(limit);
    renderLogs(logs);
  }catch(e){
    if(els.logsContainer) els.logsContainer.textContent = '获取日志失败: ' + e.message;
  }
}

async function clearLogs(){
  try{
    const ok = confirm('确定清空所有日志？'); if(!ok) return;
    const r = await chrome.runtime.sendMessage({ type:'CLEAR_TASK_LOGS' });
    if(!r?.ok) throw new Error(r.error||'清空失败');
    await refreshLogs();
  }catch(e){
    alert('清空失败: ' + e.message);
  }
}
