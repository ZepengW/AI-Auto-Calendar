// Options page script (MV3) - moved from inline
import { loadSettings, saveSettings, DEFAULTS } from './shared.js';

const els = {
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

function fillProvider(){ /* removed global provider config */ }

async function init(){
  // map elements
  // removed global Radicale/LLM settings; now managed via nodes
  els.lastSync = qs('lastSync'); // removed in UI, keep null-safe
  els.saveBtn = qs('save');
  els.syncNow = qs('syncNow'); // removed in UI, keep null-safe
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
  els.runAllTasks = qs('runAllTasks');
  // parsers UI
  els.parserList = qs('parserList');
  els.parsersEmpty = qs('parsersEmpty');
  els.addParser = qs('addParser');
  // removed per-section authorize
  els.parserModal = qs('parserModal');
  els.parserForm = qs('parserForm');
  els.parserModalTitle = qs('parserModalTitle');
  els.parser_name = qs('parser_name');
  els.parser_type = qs('parser_type');
  // parser typed fields
  els.p_zhipu_apiUrl = qs('p_zhipu_apiUrl');
  els.p_zhipu_apiKey = qs('p_zhipu_apiKey');
  els.p_zhipu_agentId = qs('p_zhipu_agentId');
  // removed: prompt/jsonPaths for zhipu node
  els.p_json_map_title = qs('p_json_map_title');
  els.p_json_map_location = qs('p_json_map_location');
  els.p_json_map_startTime = qs('p_json_map_startTime');
  els.p_json_map_endTime = qs('p_json_map_endTime');
  els.p_json_map_uid = qs('p_json_map_uid');
  els.p_json_map_description = qs('p_json_map_description');
  els.p_json_def_title = qs('p_json_def_title');
  els.p_json_def_location = qs('p_json_def_location');
  els.p_json_def_startTime = qs('p_json_def_startTime');
  els.p_json_def_endTime = qs('p_json_def_endTime');
  els.p_json_def_uid = qs('p_json_def_uid');
  els.p_json_def_description = qs('p_json_def_description');
  els.closeParserModal = qs('closeParserModal');
  els._editingParserId = null;
  // servers UI
  els.serverList = qs('serverList');
  els.serversEmpty = qs('serversEmpty');
  els.addServer = qs('addServer');
  // removed per-section authorize
  els.defaultServerSelect = qs('defaultServerSelect');
  els.serverModal = qs('serverModal');
  els.serverForm = qs('serverForm');
  els.serverModalTitle = qs('serverModalTitle');
  els.server_name = qs('server_name');
  els.server_type = qs('server_type');
  // server typed fields
  els.s_default_calendar_name = qs('s_default_calendar_name');
  els.s_radicale_base = qs('s_radicale_base');
  els.s_radicale_username = qs('s_radicale_username');
  els.s_radicale_auth = qs('s_radicale_auth');
  // google fields (no user inputs; only authorize/status)
  els.btnGoogleAuthorize = qs('btnGoogleAuthorize');
  els.googleRedirectHint = qs('google_redirect_hint');
  els.googleAuthStatus = qs('googleAuthStatus');
  els.closeServerModal = qs('closeServerModal');
  els._editingServerId = null;
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
  els.task_jsonPaths = qs('task_jsonPaths');
  els.task_jsonPaths_wrap = qs('task_jsonPaths_wrap');
  els.task_parserId = qs('task_parserId');
  els.task_serverId = qs('task_serverId');
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
  // permissions banner
  els.permBanner = qs('permBanner');
  els.btnAuthorizeMissing = qs('btnAuthorizeMissing');
  els.btnAuthorizeAll = qs('btnAuthorizeAll');

  const cfg = await loadSettings();
  // cache loaded settings (contains DEFAULTS + config/dev.json overrides + saved settings)
  els._settings = cfg;
  if(els.pageParseEnabled) els.pageParseEnabled.value = cfg.pageParseEnabled ? 'true':'false';
  // lastSync removed from UI
  if(els.pageParseStrategy) els.pageParseStrategy.value = cfg.pageParseStrategy || 'fetch';
  if(els.pageParseJsonPaths) els.pageParseJsonPaths.value = cfg.pageParseJsonPaths || DEFAULTS.pageParseJsonPaths;
  if(els.pageParseJsonModeRadios){
    const mode = cfg.pageParseJsonMode || DEFAULTS.pageParseJsonMode || 'llm';
    els.pageParseJsonModeRadios.forEach(r => r.checked = (r.value === mode));
  }
  updateJsonPanelVisibility();
  fillProvider();

  els.saveBtn?.addEventListener('click', saveAll);
  // syncNow removed (each task can run individually)
  els.pageParseRun?.addEventListener('click', ()=> alert('旧版单任务即将移除，请使用上方多任务')); // deprecate
  els.pageParseStrategy?.addEventListener('change', updateJsonPanelVisibility);
  els.pageParseJsonModeRadios?.forEach(r => r.addEventListener('change', ()=>{}));
  // multi task events
  els.addPageTask?.addEventListener('click', ()=> openTaskModal());
  els.runAllTasks?.addEventListener('click', runAllEnabledTasks);
  els.addParser?.addEventListener('click', ()=> openParserModal());
  els.closeParserModal?.addEventListener('click', closeParserModal);
  els.parserForm?.addEventListener('submit', submitParserForm);
  els.parser_type?.addEventListener('change', onParserTypeChange);
  els.addServer?.addEventListener('click', ()=> openServerModal());
  els.closeServerModal?.addEventListener('click', closeServerModal);
  els.serverForm?.addEventListener('submit', submitServerForm);
  els.server_type?.addEventListener('change', onServerTypeChange);
  els.btnGoogleAuthorize?.addEventListener('click', onClickGoogleAuthorize);
  els.defaultServerSelect?.addEventListener('change', saveDefaultServerSelection);
  els.closeTaskModal?.addEventListener('click', closeTaskModal);
  els.taskForm?.addEventListener('submit', submitTaskForm);
  els.task_mode?.addEventListener('change', updateTaskModalVisibility);
  els.task_useTimes?.addEventListener('change', updateScheduleModeVisibility);
  els.task_visitTrigger?.addEventListener('change', updateVisitPatternsVisibility);
  els.task_time_add?.addEventListener('click', addTimePoint);
  els.taskRunOnce?.addEventListener('click', tryRunOnceCurrentTask);

  await loadRenderTasks();
  await loadRenderParsers();
  await loadRenderServers();
  // permissions check after lists are loaded
  await checkAndTogglePermBanner();
  els.btnAuthorizeMissing?.addEventListener('click', authorizeMissing);
  els.btnAuthorizeAll?.addEventListener('click', authorizeAll);
  // initial logs load
  await refreshLogs();
  els.refreshLogs?.addEventListener('click', refreshLogs);
  els.clearLogs?.addEventListener('click', clearLogs);
  els.logLimit?.addEventListener('change', refreshLogs);

  // Deep-link: open specific task editor or add modal when hash is provided
  try {
    const hash = location.hash || '';
    if(hash.startsWith('#editTask=')){
      const taskId = decodeURIComponent(hash.slice('#editTask='.length));
      if(taskId){
        const resp = await chrome.runtime.sendMessage({ type:'GET_PAGE_TASKS' });
        const tasks = (resp?.tasks)||[];
        const t = tasks.find(x=> x.id === taskId);
        if(t) openTaskModal(t);
      }
    } else if(hash.startsWith('#addTask')){
      openTaskModal();
    }
  } catch(e){ /* ignore deep-link errors */ }
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
  els.task_jsonPaths.value = task?.modeConfig?.jsonPaths || task?.jsonPaths || 'data.events[*]';
  // parser selection
  els.task_parserId.value = task?.modeConfig?.parserId || '';
  // server selection
  els.task_serverId.value = task?.serverId || '';
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
      parserId: (els.task_parserId?.value || '').trim() || undefined,
  // parseMode removed: behavior is determined by selected parser or fallback
    },
    serverId: (els.task_serverId?.value || '').trim() || undefined,
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

async function runAllEnabledTasks(){
  try{
    const resp = await chrome.runtime.sendMessage({ type:'GET_PAGE_TASKS' });
    const tasks = (resp?.tasks)||[];
    const enabled = tasks.filter(t=> t.enabled);
    if(!enabled.length){ alert('当前没有启用的任务'); return; }
    // 顺序触发，避免并发对权限/服务造成瞬时压力
    for(const t of enabled){
      try { await chrome.runtime.sendMessage({ type:'RUN_PAGE_TASK', id: t.id }); } catch(_){ /* 单个失败忽略 */ }
    }
    alert('已触发所有启用任务');
  }catch(e){ alert('批量运行失败: ' + e.message); }
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
      pageParseUrl: (els.pageParseUrl?.value || '').trim(),
      pageParseInterval: Number(els.pageParseInterval?.value) || 0,
      pageParseCalendarName: (els.pageParseCalendarName?.value || '').trim(),
      pageParseEnabled: els.pageParseEnabled?.value === 'true',
      pageParseStrategy: els.pageParseStrategy?.value || 'fetch',
      pageParseJsonPaths: (els.pageParseJsonPaths?.value || '').trim(),
      pageParseJsonMode: (els.pageParseJsonModeRadios?.find(r=>r.checked)?.value) || 'llm',
    };
    await saveSettings(patch);
    alert('已保存');
  } catch(e){
    console.error('保存失败', e);
    alert('保存失败: ' + (e.message || e));
  }
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

// ---------------- Parsers management ----------------
async function loadParsers(){
  const r = await chrome.runtime.sendMessage({ type:'GET_PARSERS' });
  if(!r?.ok) throw new Error(r.error||'获取解析器失败');
  return r.parsers || [];
}

async function saveParsers(parsers){
  const r = await chrome.runtime.sendMessage({ type:'SAVE_PARSERS', parsers });
  if(!r?.ok) throw new Error(r.error||'保存解析器失败');
  return r.parsers;
}

async function loadRenderParsers(){
  try {
    const parsers = await loadParsers();
    renderParsers(parsers);
    populateParserSelect(parsers);
  } catch(e){ console.error('加载解析器失败', e); }
}

function renderParsers(parsers){
  if(!els.parserList) return;
  els.parserList.innerHTML='';
  const empty = els.parsersEmpty;
  if(!parsers.length){ if(empty) empty.style.display='block'; return; } else if(empty) empty.style.display='none';
  for(const p of parsers){
    const li = document.createElement('li');
    li.style.cssText = 'border:1px solid #d4dbe6;padding:8px 10px;border-radius:10px;background:#fff;display:flex;flex-direction:column;gap:6px';
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">
        <span>${escapeHtml(p.name||'未命名')}</span>
        <span style="font-size:11px;color:#555">${escapeHtml(p.type||'')}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button data-act="edit" style="flex:1;background:#fff;border:1px solid #c5d3e2;border-radius:6px;padding:6px 0;font-size:12px;cursor:pointer">编辑</button>
        <button data-act="del" style="flex:1;background:#fff;border:1px solid #f0b6b6;color:#c24d4d;border-radius:6px;padding:6px 0;font-size:12px;cursor:pointer">删除</button>
      </div>`;
    li.querySelector('[data-act=edit]').addEventListener('click', ()=> openParserModal(p, parsers));
    li.querySelector('[data-act=del]').addEventListener('click', async ()=>{
      const list = parsers.filter(x=> x.id !== p.id);
      await saveParsers(list);
      renderParsers(list);
      populateParserSelect(list);
    });
    els.parserList.appendChild(li);
  }
}

function populateParserSelect(parsers){
  if(!els.task_parserId) return;
  const sel = els.task_parserId;
  sel.innerHTML = '<option value="">(不使用解析节点)</option>';
  for(const p of parsers){
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = `${p.name} (${p.type})`;
    sel.appendChild(opt);
  }
}

function openParserModal(parser, all){
  els._editingParserId = parser?.id || null;
  els.parserModalTitle.textContent = parser? '编辑解析节点':'新增解析节点';
  els.parser_name.value = parser?.name || '';
  els.parser_type.value = parser?.type || 'zhipu_agent';
  // fill type fields
  if(els.parser_type.value === 'zhipu_agent'){
    const c = parser?.config || {};
    els.p_zhipu_apiUrl.value = c.apiUrl || DEFAULTS.llmApiUrl || '';
    els.p_zhipu_apiKey.value = c.apiKey || '';
    els.p_zhipu_agentId.value = c.agentId || DEFAULTS.llmAgentId || '';
    showParserPanel('zhipu');
  } else {
    const c = parser?.config || {};
    els.p_json_map_title.value = (c.fieldMap?.title||[]).join(',');
    els.p_json_map_location.value = (c.fieldMap?.location||[]).join(',');
    els.p_json_map_startTime.value = (c.fieldMap?.startTime||[]).join(',');
    els.p_json_map_endTime.value = (c.fieldMap?.endTime||[]).join(',');
    els.p_json_map_uid.value = (c.fieldMap?.uid||[]).join(',');
    els.p_json_map_description.value = (c.fieldMap?.description||[]).join(',');
    els.p_json_def_title.value = c.defaults?.title || '';
    els.p_json_def_location.value = c.defaults?.location || '';
    els.p_json_def_startTime.value = c.defaults?.startTime || '';
    els.p_json_def_endTime.value = c.defaults?.endTime || '';
    els.p_json_def_uid.value = c.defaults?.uid || '';
    els.p_json_def_description.value = c.defaults?.description || '';
    showParserPanel('json');
  }
  els._parsersCache = all || null;
  els.parserModal.style.display='flex';
}

function closeParserModal(){ els.parserModal.style.display='none'; els._editingParserId = null; }

async function submitParserForm(ev){
  ev.preventDefault();
  const type = els.parser_type.value;
  let cfg = {};
  if(type === 'zhipu_agent'){
    cfg = { apiUrl: (els.p_zhipu_apiUrl.value||'').trim(), apiKey:(els.p_zhipu_apiKey.value||'').trim(), agentId:(els.p_zhipu_agentId.value||'').trim() };
  } else if(type === 'json_mapping'){
  cfg = { fieldMap: {
      title: (els.p_json_map_title.value||'').split(',').map(s=>s.trim()).filter(Boolean),
      location: (els.p_json_map_location.value||'').split(',').map(s=>s.trim()).filter(Boolean),
      startTime: (els.p_json_map_startTime.value||'').split(',').map(s=>s.trim()).filter(Boolean),
      endTime: (els.p_json_map_endTime.value||'').split(',').map(s=>s.trim()).filter(Boolean),
      uid: (els.p_json_map_uid.value||'').split(',').map(s=>s.trim()).filter(Boolean),
      description: (els.p_json_map_description.value||'').split(',').map(s=>s.trim()).filter(Boolean),
    }, defaults: {
      title: (els.p_json_def_title.value||'').trim() || undefined,
      location: (els.p_json_def_location.value||'').trim() || undefined,
      startTime: (els.p_json_def_startTime.value||'').trim() || undefined,
      endTime: (els.p_json_def_endTime.value||'').trim() || undefined,
      uid: (els.p_json_def_uid.value||'').trim() || undefined,
      description: (els.p_json_def_description.value||'').trim() || undefined,
    } };
  }
  try {
    const list = els._parsersCache || await loadParsers();
    const data = {
      id: els._editingParserId || ('parser-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6)),
      name: els.parser_name.value.trim() || '未命名解析器',
      type,
      config: cfg,
    };
    const newList = els._editingParserId ? list.map(x=> x.id===data.id? data: x) : [...list, data];
    const saved = await saveParsers(newList);
    const current = saved.find(x=> x.id === data.id);
    if(current){ await requestParserPermissions(current, { silent: true }); }
    renderParsers(saved);
    populateParserSelect(saved);
    closeParserModal();
  } catch(e){ alert('保存解析器失败: '+ e.message); }
}

function onParserTypeChange(){
  const t = els.parser_type?.value || 'zhipu_agent';
  if(t === 'zhipu_agent') showParserPanel('zhipu'); else showParserPanel('json');
}

function showParserPanel(kind){
  const a = document.getElementById('parser_panel_zhipu');
  const b = document.getElementById('parser_panel_jsonmap');
  if(!a||!b) return;
  a.style.display = kind==='zhipu' ? 'flex' : 'none';
  b.style.display = kind==='json' ? 'flex' : 'none';
}

// ---------------- Servers management ----------------
async function loadServers(){
  const r = await chrome.runtime.sendMessage({ type:'GET_SERVERS' });
  if(!r?.ok) throw new Error(r.error||'获取服务器失败');
  return r.servers || [];
}

async function saveServers(servers){
  const r = await chrome.runtime.sendMessage({ type:'SAVE_SERVERS', servers });
  if(!r?.ok) throw new Error(r.error||'保存服务器失败');
  return r.servers;
}

async function loadRenderServers(){
  try {
    const servers = await loadServers();
    renderServers(servers);
    populateServerSelects(servers);
    // set default select from storage
    const cfg = await loadSettings();
    if(els.defaultServerSelect){ els.defaultServerSelect.value = cfg.selectedServerId || ''; }
  } catch(e){ console.error('加载服务器失败', e); }
}

function renderServers(servers){
  if(!els.serverList) return;
  els.serverList.innerHTML='';
  const empty = els.serversEmpty;
  if(!servers.length){ if(empty) empty.style.display='block'; return; } else if(empty) empty.style.display='none';
  for(const s of servers){
    const li = document.createElement('li');
    li.style.cssText = 'border:1px solid #d4dbe6;padding:8px 10px;border-radius:10px;background:#fff;display:flex;flex-direction:column;gap:6px';
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">
        <span>${escapeHtml(s.name||'未命名')}</span>
        <span style="font-size:11px;color:#555">${escapeHtml(s.type||'')}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button data-act="edit" style="flex:1;background:#fff;border:1px solid #c5d3e2;border-radius:6px;padding:6px 0;font-size:12px;cursor:pointer">编辑</button>
        <button data-act="del" style="flex:1;background:#fff;border:1px solid #f0b6b6;color:#c24d4d;border-radius:6px;padding:6px 0;font-size:12px;cursor:pointer">删除</button>
      </div>`;
    li.querySelector('[data-act=edit]').addEventListener('click', ()=> openServerModal(s, servers));
    li.querySelector('[data-act=del]').addEventListener('click', async ()=>{
      const list = servers.filter(x=> x.id !== s.id);
      await saveServers(list);
      renderServers(list);
      populateServerSelects(list);
    });
    els.serverList.appendChild(li);
  }
}

function populateServerSelects(servers){
  const opts = ['<option value="">(默认)</option>'].concat((servers||[]).map(s=> `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.type)})</option>`)).join('');
  if(els.task_serverId) els.task_serverId.innerHTML = opts;
  if(els.defaultServerSelect) els.defaultServerSelect.innerHTML = ['<option value="">(不设置)</option>'].concat((servers||[]).map(s=> `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.type)})</option>`)).join('');
}

function openServerModal(server, all){
  els._editingServerId = server?.id || null;
  els.serverModalTitle.textContent = server? '编辑服务器节点':'新增服务器节点';
  els.server_name.value = server?.name || '';
  els.server_type.value = server?.type || 'radicale';
  const c = server?.config || {};
  if(els.s_default_calendar_name) els.s_default_calendar_name.value = c.defaultCalendarName || '';
  els.s_radicale_base.value = c.base || '';
  els.s_radicale_username.value = c.username || '';
  els.s_radicale_auth.value = c.auth || '';
  // No Google input fields; values come from dev config/DEFAULTS in runtime code
  if(els.googleRedirectHint){ els.googleRedirectHint.textContent = `https://${chrome.runtime.id}.chromiumapp.org/`; }
  if(els.googleAuthStatus){
    // Prefer showing Identity status if available
    try{
      const manifest = chrome.runtime.getManifest?.() || {};
      if(manifest.oauth2 && chrome.identity?.getAuthToken){
        chrome.identity.getAuthToken({ interactive: false }, (tok)=>{
          if(tok) els.googleAuthStatus.textContent = '已授权(浏览器身份)';
          else els.googleAuthStatus.textContent = c.token?.access_token ? '已授权' : '未授权';
        });
      } else {
        els.googleAuthStatus.textContent = c.token?.access_token ? '已授权' : '未授权';
      }
    } catch{ els.googleAuthStatus.textContent = c.token?.access_token ? '已授权' : '未授权'; }
  }
  els._serversCache = all || null;
  onServerTypeChange();
  els.serverModal.style.display='flex';
}

function closeServerModal(){ els.serverModal.style.display='none'; els._editingServerId=null; }

async function submitServerForm(ev){
  ev.preventDefault();
  let cfg = {};
  const type = els.server_type.value;
  if(type === 'radicale'){
    cfg = { base: (els.s_radicale_base.value||'').trim(), username:(els.s_radicale_username.value||'').trim(), auth:(els.s_radicale_auth.value||'').trim() };
  } else if(type === 'google'){
    // No user-entered Google fields; rely on packaged config/DEFAULTS at runtime
    cfg = {};
  }
  // common: default calendar name
  const defCal = (els.s_default_calendar_name?.value||'').trim();
  if(defCal) cfg.defaultCalendarName = defCal;
  try {
    const list = els._serversCache || await loadServers();
    const id = els._editingServerId || ('server-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6));
    const name = els.server_name.value.trim()||'未命名服务器';
    let newList;
    if(els._editingServerId){
      const old = list.find(x=> x.id === id);
      const oldType = old?.type;
      const oldCfg = old?.config || {};
      let mergedCfg = { ...oldCfg, ...cfg };
      // If switching type or changing Google clientId, drop stored token to avoid mismatch
      if(oldType !== type){ delete mergedCfg.token; }
      if(type !== 'google'){
        // Non-google server does not keep google token
        delete mergedCfg.token;
      }
      const data = { id, name, type, config: mergedCfg };
      newList = list.map(x=> x.id===id? data: x);
    } else {
      const data = { id, name, type, config: cfg };
      newList = [...list, data];
    }
  const saved = await saveServers(newList);
  const current = saved.find(x=> x.id === id);
    if(current){ await requestServerPermissions(current, { silent: true }); }
    renderServers(saved);
    populateServerSelects(saved);
    closeServerModal();
  } catch(e){ alert('保存服务器失败: '+ e.message); }
}

function onServerTypeChange(){
  const t = els.server_type?.value || 'radicale';
  const a = document.getElementById('server_panel_radicale');
  const b = document.getElementById('server_panel_google');
  if(a) a.style.display = t==='radicale' ? 'flex':'none';
  if(b) b.style.display = t==='google' ? 'flex':'none';
}

async function onClickGoogleAuthorize(){
  if(!els._editingServerId){ alert('请先保存服务器后再授权'); return; }
  try {
    const r = await chrome.runtime.sendMessage({ type:'AUTHORIZE_SERVER', id: els._editingServerId });
    if(!r?.ok) throw new Error(r.error||'授权失败');
    if(els.googleAuthStatus) els.googleAuthStatus.textContent = '已授权';
    alert('Google 授权完成');
  } catch(e){ alert('授权失败: ' + e.message); }
}

async function saveDefaultServerSelection(){
  try{
    const id = (els.defaultServerSelect?.value || '').trim();
    await saveSettings({ selectedServerId: id || undefined });
  }catch(e){ console.error('保存默认服务器失败', e); }
}

// Compute missing optional host permissions and toggle banner
async function checkAndTogglePermBanner(){
  try{
    const [servers, parsers] = await Promise.all([loadServers(), loadParsers()]);
    const origins = [
      ...servers.flatMap(buildOriginsForServer),
      ...parsers.flatMap(buildOriginsForParser)
    ];
    const uniq = Array.from(new Set(origins.filter(Boolean)));
    if(!uniq.length){ if(els.permBanner) els.permBanner.style.display='none'; return; }
    const hasAll = await chrome.permissions.contains({ origins: uniq });
    if(els.permBanner) els.permBanner.style.display = hasAll ? 'none':'block';
  }catch(e){ console.warn('权限检查失败', e); }
}

async function authorizeMissing(){
  try{
    const [servers, parsers] = await Promise.all([loadServers(), loadParsers()]);
    const origins = [
      ...servers.flatMap(buildOriginsForServer),
      ...parsers.flatMap(buildOriginsForParser)
    ];
    const res = await ensureHostPermissions(origins, false);
    if(res.ok){ await checkAndTogglePermBanner(); }
  }catch(e){ alert('授权失败: '+ e.message); }
}

// Global one-click authorization: gather all needed origins across servers/parsers and request once
async function authorizeAll(){
  try{
    const [servers, parsers] = await Promise.all([loadServers(), loadParsers()]);
    const origins = [
      ...servers.flatMap(buildOriginsForServer),
      ...parsers.flatMap(buildOriginsForParser)
    ];
    const res = await ensureHostPermissions(origins, false);
    if(res.ok){ await checkAndTogglePermBanner(); if(res.granted){ alert('已申请所需站点权限'); } }
  }catch(e){ alert('授权失败: ' + e.message); }
}

// ---------------- Dynamic host permission helpers ----------------
function buildOriginsFromUrl(u){
  try{
    const url = new URL(u);
    return [`${url.protocol}//${url.hostname}${url.port? (":"+url.port):''}/*`];
  }catch{ return []; }
}

function buildOriginsForServer(server){
  if(!server) return [];
  if(server.type === 'radicale'){
    const base = server.config?.base || '';
    return buildOriginsFromUrl(base);
  }
  if(server.type === 'google'){
    return ['https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*'];
  }
  return [];
}

function buildOriginsForParser(parser){
  if(!parser) return [];
  if(parser.type === 'zhipu_agent'){
    const apiUrl = parser.config?.apiUrl || '';
    return buildOriginsFromUrl(apiUrl);
  }
  return [];
}

async function ensureHostPermissions(origins, silent){
  const uniq = Array.from(new Set((origins||[]).filter(Boolean)));
  if(!uniq.length) return { ok:true, granted:false };
  try{
    const already = await chrome.permissions.contains({ origins: uniq });
    if(already) return { ok:true, granted:true, already:true };
    const granted = await chrome.permissions.request({ origins: uniq });
    if(!granted && !silent){ alert('用户未授权访问这些地址：\n'+ uniq.join('\n')); }
    return { ok:true, granted };
  }catch(e){ if(!silent) alert('请求权限失败: '+ e.message); return { ok:false, error:e.message }; }
}

async function requestServerPermissions(server, opts){
  const origins = buildOriginsForServer(server);
  if(!origins.length) return { ok:true, granted:false };
  return await ensureHostPermissions(origins, opts?.silent);
}

async function requestParserPermissions(parser, opts){
  const origins = buildOriginsForParser(parser);
  if(!origins.length) return { ok:true, granted:false };
  return await ensureHostPermissions(origins, opts?.silent);
}

async function authorizeAllServers(){
  // deprecated by global authorizeAll
}

async function authorizeAllParsers(){
  // deprecated by global authorizeAll
}
