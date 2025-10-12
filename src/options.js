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
  els.defaultParserSelect = qs('defaultParserSelect');
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
  // chatgpt agent fields
  els.p_chatgpt_apiKey = qs('p_chatgpt_apiKey');
  els.p_chatgpt_model = qs('p_chatgpt_model');
  // bailian
  els.p_bailian_apiKey = qs('p_bailian_apiKey');
  els.p_bailian_agentId = qs('p_bailian_agentId');
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
  // jiaowoban fields
  els.p_jwb_title = qs('p_jwb_title');
  els.p_jwb_startTime = qs('p_jwb_startTime');
  els.p_jwb_endTime = qs('p_jwb_endTime');
  els.p_jwb_location = qs('p_jwb_location');
  els.p_jwb_status = qs('p_jwb_status');
  els.p_jwb_id = qs('p_jwb_id');
  els.closeParserModal = qs('closeParserModal');
  els._editingParserId = null;
  // servers UI
  els.serverList = qs('serverList');
  els.serversEmpty = qs('serversEmpty');
  els.addServer = qs('addServer');
  els.defaultServerSelect = qs('defaultServerSelect');
  els.serverModal = qs('serverModal');
  els.serverForm = qs('serverForm');
  els.serverModalTitle = qs('serverModalTitle');
  els.server_name = qs('server_name');
  els.server_type = qs('server_type');
  els.s_default_calendar_name = qs('s_default_calendar_name');
  els.s_radicale_base = qs('s_radicale_base');
  els.s_radicale_username = qs('s_radicale_username');
  els.s_radicale_auth = qs('s_radicale_auth');
  els.btnGoogleAuthorize = qs('btnGoogleAuthorize');
  els.btnGoogleForceConsent = qs('btnGoogleForceConsent');
  els.btnGoogleRevoke = qs('btnGoogleRevoke');
  els.googleRedirectHint = qs('google_redirect_hint');
  els.googleAuthStatus = qs('googleAuthStatus');
  els.googleTermsAccept = qs('google_terms_accept');
  els.googleTermsHint = qs('google_terms_hint');
  els.closeServerModal = qs('closeServerModal');
  els._editingServerId = null;
  els._serversCache = null;
  els._pendingGoogleConfig = null;
  // task modal elements (previously not mapped, caused add task click no-op)
  els.taskModal = qs('taskModal');
  els.taskModalTitle = qs('taskModalTitle');
  els.taskForm = qs('taskForm');
  els.task_name = qs('task_name');
  els.task_calendarName = qs('task_calendarName');
  els.task_enabled = qs('task_enabled');
  els.task_interval = qs('task_interval');
  els.task_useInterval = qs('task_useInterval');
  els.task_useTimes = qs('task_useTimes');
  els.task_times_list = qs('task_times_list');
  els.task_time_input = qs('task_time_input');
  els.task_time_add = qs('task_time_add');
  els.schedule_times_wrap = qs('schedule_times_wrap');
  els.task_visitTrigger = qs('task_visitTrigger');
  els.visit_patterns_wrap = qs('visit_patterns_wrap');
  els.task_visitPatterns = qs('task_visitPatterns');
  els.task_mode = qs('task_mode');
  els.task_url = qs('task_url');
  els.task_warmupUrl = qs('task_warmupUrl');
  els.task_warmupSilent = qs('task_warmupSilent');
  els.task_warmupWaitMs = qs('task_warmupWaitMs');
  els.task_jsonPaths_wrap = qs('task_jsonPaths_wrap');
  els.task_jsonPaths = qs('task_jsonPaths');
  els.task_parserId = qs('task_parserId');
  els.task_serverId = qs('task_serverId');
  els.task_jwb_windowDays = qs('task_jwb_windowDays');
  els.task_jwb_coverage = qs('task_jwb_coverage');
  els.taskRunOnce = qs('taskRunOnce');
  els.closeTaskModal = qs('closeTaskModal');
  // logs & permissions elements (ensure event bindings work)
  els.logsContainer = qs('logs-container');
  els.logLimit = qs('log-limit');
  els.refreshLogs = qs('btn-refresh-logs');
  els.clearLogs = qs('btn-clear-logs');
  els.logTypeFilter = qs('log-type-filter');
  els.logModeFilter = qs('log-mode-filter');
  els.logTaskFilter = qs('log-task-filter');
  els.btnAuthorizeAll = qs('btnAuthorizeAll');
  els.btnAuthorizeMissing = qs('btnAuthorizeMissing');
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
  els.btnGoogleForceConsent?.addEventListener('click', ()=> onClickGoogleAuthorize({ forceConsent:true }));
  els.btnGoogleRevoke?.addEventListener('click', onClickGoogleRevoke);
  els.googleTermsAccept?.addEventListener('change', ()=>{
    // For unsaved server, store acceptance in pending config so user can auth first
    if(els.server_type?.value === 'google'){
      if(!els._editingServerId){
        if(els.googleTermsAccept.checked){
          els._pendingGoogleConfig = { ...(els._pendingGoogleConfig||{}), termsAcceptedAt: Date.now() };
        } else if(els._pendingGoogleConfig){
          delete els._pendingGoogleConfig.termsAcceptedAt;
        }
      } else if(els._editingServerId && Array.isArray(els._serversCache)){
        // editing existing: do not immediately persist; only affect UI gating pre-save
        const cur = els._serversCache.find(x=> x.id === els._editingServerId);
        if(cur && cur.type==='google'){
          // if user unchecks we only gate UI but keep stored acceptance until they save (optional design)
        }
      }
      updateGoogleAuthUI();
    }
  });
  els.defaultServerSelect?.addEventListener('change', saveDefaultServerSelection);
  els.defaultParserSelect?.addEventListener('change', saveDefaultParserSelection);
  els.closeTaskModal?.addEventListener('click', closeTaskModal);
  els.taskForm?.addEventListener('submit', submitTaskForm);
  els.task_mode?.addEventListener('change', updateTaskModalVisibility);
  // JWB panel dynamic inputs
  els.task_jwb_windowDays = qs('task_jwb_windowDays');
  els.task_jwb_coverage = qs('task_jwb_coverage');
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

  // Load debug flag last (after settings potentially merged elsewhere)
  // removed debug flag UI; keep existing stored setting untouched
}

function updateJsonPanelVisibility(){
  if(!els.jsonExtractPanel) return;
  const strat = els.pageParseStrategy?.value || 'fetch';
  els.jsonExtractPanel.style.display = strat === 'fetch' ? 'block':'none';
}

function updateTaskModalVisibility(){
  const mode = els.task_mode?.value || 'HTTP_GET_JSON';
  const panelHttp = document.getElementById('modePanel_HTTP_GET_JSON');
  const panelJwb = document.getElementById('modePanel_SJTU_JWB');
  if(panelHttp) panelHttp.style.display = mode === 'HTTP_GET_JSON' ? 'flex':'none';
  if(panelJwb) panelJwb.style.display = mode === 'SJTU_JWB' ? 'flex':'none';
  if(els.task_jsonPaths_wrap){
    // 交我办模式不需要 URL/路径裁剪；隐藏 JSON 路径
    els.task_jsonPaths_wrap.style.display = (mode === 'HTTP_GET_JSON') ? 'block':'none';
  }
  // 当切换到 JWB 模式时，如果没有现成的 jiaowoban 解析节点则自动创建并选中
  if(mode === 'SJTU_JWB'){
    ensureJwbParserExistsAndSelect();
  }
  // 动态 required：避免浏览器原生校验阻止提交
  if(els.task_url){
    if(mode === 'HTTP_GET_JSON'){
      els.task_url.setAttribute('required','required');
      els.task_url.disabled = false;
    } else {
      els.task_url.removeAttribute('required');
      // 可选：禁用避免用户误填
      els.task_url.disabled = true;
    }
  }
}

async function ensureJwbParserExistsAndSelect(){
  try {
    // 读取缓存的解析器或重新加载
    let parsers = els._parsersCache;
    if(!Array.isArray(parsers)){
      const r = await chrome.runtime.sendMessage({ type:'GET_PARSERS' });
      parsers = r?.parsers||[];
      els._parsersCache = parsers;
    }
    let jwb = parsers.find(p=> p.type === 'jiaowoban');
    if(!jwb){
      // 创建一个默认交我办解析节点（无需额外配置）
      const newParser = { id: 'parser-jwb-default', name: '交我办解析', type: 'jiaowoban', config: { fieldMap: { title:['title'], startTime:['startTime'], endTime:['endTime'], location:['location'], status:['status'], id:['eventId','id'] } } };
      const saveResp = await chrome.runtime.sendMessage({ type:'SAVE_PARSERS', parsers: [...parsers, newParser] });
      if(saveResp?.parsers) { parsers = saveResp.parsers; els._parsersCache = parsers; }
      jwb = parsers.find(p=> p.type === 'jiaowoban');
      // 重新渲染解析节点列表和下拉
      await loadRenderParsers();
    }
    if(jwb && els.task_parserId){ els.task_parserId.value = jwb.id; }
  } catch(e){ console.warn('自动创建/选择交我办解析节点失败', e); }
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
    const tasks = resp.tasks||[];
    // merge stats
    try {
      const s = await loadSettings();
      const stats = Array.isArray(s.pageTaskStats)? s.pageTaskStats : [];
      const lastStats = Array.isArray(s.pageTaskLastStats)? s.pageTaskLastStats : [];
      tasks.forEach(t=>{
        const st = stats.find(x=> x.id === t.id);
        if(st){ t._lastAdded = st.added; t._lastTotal = st.total; t._lastTs = st.ts; }
        const ls = lastStats.find(x=> x.id === t.id);
        if(ls){ t._lastDetail = ls; }
      });
    } catch(_){ /* ignore stats retrieval errors */ }
    renderTasks(tasks);
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
    const lastAdded = t._lastAdded != null ? t._lastAdded : (t.lastAdded!=null? t.lastAdded: null);
    const lastTotal = t._lastTotal != null ? t._lastTotal : (t.lastTotal!=null? t.lastTotal: null);
    let statsLine = '';
    if(t._lastDetail){
      const d = t._lastDetail;
      const when = new Date(d.ts).toLocaleString();
      statsLine = `<div style="font-size:11px;color:#555">上次(${when}): 获取(${d.fetched||0})/新增(${d.inserted||0})/更新(${d.updated||0})/删(${d.deleted||0})/跳过(${d.skipped||0})${d.coverage? ' [覆盖]':''}</div>`;
    } else if(lastAdded!=null || lastTotal!=null){
      statsLine = `<div style="font-size:11px;color:#666">最近: +${lastAdded||0}${lastTotal!=null? ' (总'+lastTotal+')':''}</div>`;
    }
    const modeBadge = t.mode==='SJTU_JWB' ? '<span style="background:#fde68a;color:#92400e;padding:2px 6px;border-radius:6px;font-size:11px">交我办</span>' : '';
    const coverageFlag = (t.mode==='SJTU_JWB' && t.modeConfig?.coverage) ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 6px;border-radius:6px;font-size:11px">覆盖</span>' : '';
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">
        <span title="${escapeHtml(t.modeConfig?.url||'')}">${escapeHtml(t.name||'未命名')} ${modeBadge} ${coverageFlag}</span>
        <span style="font-size:11px;font-weight:500;color:${t.enabled?'#0b6':'#999'}">${t.enabled?'启用':'停用'}</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#555">
        ${t.useInterval ? `<span>间隔 ${t.intervalMinutes||t.interval||60}m</span>`:''}
        ${(t.useTimes || t.scheduleType==='times') ? `<span>时点 ${Array.isArray(t.times)?t.times.join(', '):''}</span>`:''}
        ${t.visitTrigger ? `<span>访问触发</span>`:''}
        ${t.modeConfig?.warmupUrl ? `<span>预热</span>`:''}
      </div>
      ${statsLine}
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
  els.task_enabled.value = task ? (task.enabled ? 'true' : 'false') : 'true';
  els.task_url.value = task?.modeConfig?.url || task?.url || '';
  els.task_mode.value = 'HTTP_GET_JSON';
  if(task?.mode === 'SJTU_JWB'){ els.task_mode.value = 'SJTU_JWB'; }
  if(els.task_jwb_windowDays) els.task_jwb_windowDays.value = task?.mode==='SJTU_JWB'? (task.modeConfig?.windowDays || 14):14;
  if(els.task_jwb_coverage) els.task_jwb_coverage.checked = task?.mode==='SJTU_JWB' ? !!task.modeConfig?.coverage : false;
  if(els.task_warmupUrl) els.task_warmupUrl.value = task?.modeConfig?.warmupUrl || '';
  if(els.task_warmupSilent) els.task_warmupSilent.checked = task?.modeConfig?.warmupSilent !== false; // default true
  if(els.task_warmupWaitMs) els.task_warmupWaitMs.value = (task?.modeConfig?.warmupWaitMs ?? '');
  els.task_jsonPaths.value = task?.modeConfig?.jsonPaths || task?.jsonPaths || 'data.events[*]';
  // parser selection
  els.task_parserId.value = task?.modeConfig?.parserId || '';
  // server selection
  if(task?.serverId){
    els.task_serverId.value = task.serverId;
  } else if(!task && els._settings?.selectedServerId && els.task_serverId){
    // 新增任务时自动选默认服务器
    els.task_serverId.value = els._settings.selectedServerId;
  } else {
    els.task_serverId.value = task?.serverId || '';
  }
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
  const modeVal = els.task_mode.value;
  const panelJwb = document.getElementById('modePanel_SJTU_JWB');
  const jwbVisible = !!panelJwb && panelJwb.style.display !== 'none';
  // HTTP_GET_JSON 模式才校验 URL；若选择了交我办（面板可见或值是 SJTU_JWB）则不要求 URL
  if(modeVal === 'HTTP_GET_JSON' && !jwbVisible){
    const urlVal = (els.task_url.value||'').trim();
    if(!urlVal){
      alert('请填写目标 URL（HTTP_GET_JSON 模式）');
      els.task_url.focus();
      return;
    }
  }
  console.log('[options] submitTaskForm mode=%s jwbVisible=%s', modeVal, jwbVisible);
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
    modeConfig: (els.task_mode.value === 'SJTU_JWB') ? {
      windowDays: Math.max(1, Math.min(90, Number(els.task_jwb_windowDays?.value)||14)),
      coverage: !!els.task_jwb_coverage?.checked,
    } : {
      url: els.task_url.value.trim(),
      warmupUrl: (els.task_warmupUrl?.value||'').trim() || undefined,
      warmupSilent: !!els.task_warmupSilent?.checked,
      warmupWaitMs: (function(){ const n = Number(els.task_warmupWaitMs?.value); return Number.isFinite(n)&&n>0 ? Math.floor(n): undefined; })(),
      jsonPaths: els.task_jsonPaths.value.trim(),
      parserId: (els.task_parserId?.value || '').trim() || undefined,
    },
    serverId: (els.task_serverId?.value || '').trim() || undefined,
  };
  if(!useTimes) delete data.times; if(!useInterval) delete data.intervalMinutes;
  const newTasks = els._editingTaskId ? tasks.map(t=> t.id===data.id? data: t) : [...tasks, data];
  await saveTasks(newTasks);
  console.log('[options] Saved tasks', newTasks);
  closeTaskModal();
  // 重新从后台载入，避免前端与 sanitize 结果不一致导致误判“未保存”
  await loadRenderTasks();
  alert('任务已保存');
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

// Auto-refresh when background announces task completion
try {
  chrome.runtime.onMessage.addListener((msg)=>{
    if(msg && msg.type === 'TASK_RUN_COMPLETED'){
      // Refresh logs and tasks panel silently
      refreshLogs().catch(()=>{});
      loadRenderTasks().catch(()=>{});
    }
  });
} catch(_){ /* ignore */ }

// ---------------- Logs Panel ----------------
async function fetchLogs(limit){
  const n = Math.max(1, Math.min(Number(limit)||200, 1000));
  const r = await chrome.runtime.sendMessage({ type:'GET_TASK_LOGS', limit:n });
  if(!r?.ok) throw new Error(r.error||'获取日志失败');
  return r.logs||[];
}

function _filterLogs(all){
  if(!Array.isArray(all)) return [];
  const typeVal = els.logTypeFilter?.value || 'all';
  const modeVal = els.logModeFilter?.value || 'all';
  const key = (els.logTaskFilter?.value||'').trim().toLowerCase();
  return all.filter(it => {
    if(typeVal !== 'all'){
      if(typeVal === 'trigger' && it.type !== 'trigger') return false;
      if(typeVal === 'result_ok' && !(it.type==='result' && it.ok)) return false;
      if(typeVal === 'result_fail' && !(it.type==='result' && it.ok === false)) return false;
      if(typeVal === 'coverage' && !(it.type==='result' && it.coverage)) return false;
    }
    if(modeVal !== 'all'){
      if(it.type !== 'result') return false;
      if((it.mode||'') !== modeVal) return false;
    }
    if(key){
      const n = (it.taskName||it.taskId||'').toLowerCase();
      if(!n.includes(key)) return false;
    }
    return true;
  });
}

function renderLogs(logs){
  if(!els.logsContainer) return;
  const list = Array.isArray(logs)? logs: [];
  const filtered = _filterLogs(list);
  if(!filtered.length){ els.logsContainer.innerHTML = '<div style="color:#666">暂无匹配日志</div>'; return; }
  const fmt = (ts)=> new Date(ts).toLocaleString();
  const esc = (s)=> (s==null?'':String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])));
  const rows = filtered.map((it)=>{
    const base = `[${fmt(it.ts)}] [${it.type}] [${it.triggerType||'-'}] [${esc(it.taskName||it.taskId||'-')}]`;
    if(it.type === 'trigger'){
      return `<div>[${fmt(it.ts)}] ▶ 任务触发(${esc(it.triggerType)}) - ${esc(it.taskName||it.taskId)} ${it.info? `<span style="color:#444">${esc(JSON.stringify(it.info))}</span>`:''}</div>`;
    } else if(it.type === 'result'){
      const ok = it.ok === true;
      const color = ok ? '#0b6' : '#c24d4d';
      if(ok){
        const fetched = it.sourceCount || it.added || (it.inserted||0)+(it.skipped||0)+(it.updated||0)+(it.deleted||0);
  const tail = `成功：获取(${fetched})/新增(${it.inserted||it.added||0})/更新(${it.updated||0})/删除(${it.deleted||0})/跳过(${it.skipped||0}) mode=${esc(it.mode||'-')}${it.coverage?' [覆盖]':''}`;
        return `<div>[${fmt(it.ts)}] ✔ <span style="color:${color}">${tail}</span> - ${esc(it.taskName||it.taskId)} <span style="color:#666">${(it.durationMs||0)}ms</span></div>`;
      } else {
        const tail = `失败 ${esc(it.error||'')}`;
        return `<div>[${fmt(it.ts)}] ✖ <span style="color:${color}">${tail}</span> - ${esc(it.taskName||it.taskId)} <span style="color:#666">${(it.durationMs||0)}ms</span></div>`;
      }
    }
    return `<div>${esc(base)}</div>`;
  });
  els.logsContainer.innerHTML = rows.join('');
}
  els.logTypeFilter?.addEventListener('change', refreshLogs);
  els.logModeFilter?.addEventListener('change', refreshLogs);
  els.logTaskFilter?.addEventListener('input', ()=> { clearTimeout(els._logFilterTimer); els._logFilterTimer = setTimeout(()=> refreshLogs(), 250); });

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
    els._parsersCache = parsers;
    const settings = await loadSettings();
    if(settings) els._settings = { ...els._settings, ...settings };
    let defaultParserId = settings?.selectedParserId;
    if(parsers.length){
      const exists = parsers.some(p=> p.id === defaultParserId);
      if(!exists){
        defaultParserId = parsers[0].id;
        try {
          await saveSettings({ selectedParserId: defaultParserId });
          if(els._settings) els._settings.selectedParserId = defaultParserId;
        } catch(saveErr){ console.warn('保存默认解析节点失败', saveErr); }
      }
    } else {
      defaultParserId = undefined;
    }
    renderParsers(parsers, defaultParserId);
    populateParserSelect(parsers, defaultParserId);
  } catch(e){ console.error('加载解析器失败', e); }
}

function renderParsers(parsers, defaultParserId){
  if(!els.parserList) return;
  els.parserList.innerHTML='';
  const empty = els.parsersEmpty;
  if(!parsers.length){ if(empty) empty.style.display='block'; return; } else if(empty) empty.style.display='none';
  for(const p of parsers){
    const li = document.createElement('li');
    li.style.cssText = 'border:1px solid #d4dbe6;padding:8px 10px;border-radius:10px;background:#fff;display:flex;flex-direction:column;gap:6px';
    const isDefault = defaultParserId && p.id === defaultParserId;
    const badge = isDefault ? '<span class="badge" style="margin-left:8px">默认</span>' : '';
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">
        <span>${escapeHtml(p.name||'未命名')}${badge}</span>
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
      els._parsersCache = list;
      await loadRenderParsers();
    });
    els.parserList.appendChild(li);
  }
}

function populateParserSelect(parsers, defaultParserId){
  if(els.task_parserId){
    const sel = els.task_parserId;
    sel.innerHTML = '<option value="">(不使用解析节点)</option>';
    for(const p of parsers){
      const isDefault = defaultParserId && p.id === defaultParserId;
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.type}${isDefault?' · 默认':''})`;
      sel.appendChild(opt);
    }
  }
  if(els.defaultParserSelect){
    if(!parsers.length){
      els.defaultParserSelect.innerHTML = '<option value="" disabled>暂无解析节点</option>';
      els.defaultParserSelect.value = '';
      els.defaultParserSelect.disabled = true;
    } else {
      els.defaultParserSelect.disabled = false;
      els.defaultParserSelect.innerHTML = parsers.map(p=>{
        const label = `${escapeHtml(p.name)} (${escapeHtml(p.type)})${defaultParserId && p.id === defaultParserId ? ' (默认)' : ''}`;
        return `<option value="${p.id}">${label}</option>`;
      }).join('');
      const targetId = defaultParserId && parsers.some(p=>p.id===defaultParserId) ? defaultParserId : parsers[0].id;
      els.defaultParserSelect.value = targetId;
    }
  }
}

function openParserModal(parser, all){
  els._editingParserId = parser?.id || null;
  els.parserModalTitle.textContent = parser? '编辑解析节点':'新增解析节点';
  els.parser_name.value = parser?.name || '';
  els.parser_type.value = parser?.type || 'zhipu_agent';
  if(els.parser_type.value === 'jiaowoban'){
    const fm = parser?.config?.fieldMap || {};
    els.p_jwb_title && (els.p_jwb_title.value = (Array.isArray(fm.title)? fm.title : []).join(','));
    els.p_jwb_startTime && (els.p_jwb_startTime.value = (Array.isArray(fm.startTime)? fm.startTime : []).join(','));
    els.p_jwb_endTime && (els.p_jwb_endTime.value = (Array.isArray(fm.endTime)? fm.endTime : []).join(','));
    els.p_jwb_location && (els.p_jwb_location.value = (Array.isArray(fm.location)? fm.location : []).join(','));
    els.p_jwb_status && (els.p_jwb_status.value = (Array.isArray(fm.status)? fm.status : []).join(','));
    els.p_jwb_id && (els.p_jwb_id.value = (Array.isArray(fm.id)? fm.id : []).join(','));
  } else {
    if(els.p_jwb_title) els.p_jwb_title.value='';
    if(els.p_jwb_startTime) els.p_jwb_startTime.value='';
    if(els.p_jwb_endTime) els.p_jwb_endTime.value='';
    if(els.p_jwb_location) els.p_jwb_location.value='';
    if(els.p_jwb_status) els.p_jwb_status.value='';
    if(els.p_jwb_id) els.p_jwb_id.value='';
  }
  // fill type fields
  if(els.parser_type.value === 'zhipu_agent'){
    const c = parser?.config || {};
    els.p_zhipu_apiUrl.value = c.apiUrl || DEFAULTS.llmApiUrl || '';
    els.p_zhipu_apiKey.value = c.apiKey || '';
    els.p_zhipu_agentId.value = c.agentId || DEFAULTS.llmAgentId || '';
    showParserPanel('zhipu');
  } else if(els.parser_type.value === 'chatgpt_agent'){
    const c = parser?.config || {};
      els.p_chatgpt_apiKey.value = c.apiKey || '';
      const cgModel = c.model || DEFAULTS.openaiModel || '';
      if(cgModel && els.p_chatgpt_model && ![...els.p_chatgpt_model.options].some(o=>o.value===cgModel)){
        const opt = document.createElement('option'); opt.value=cgModel; opt.textContent=cgModel+' (自定义)'; els.p_chatgpt_model.appendChild(opt);
      }
      if(els.p_chatgpt_model) els.p_chatgpt_model.value = cgModel;
    showParserPanel('chatgpt');
  } else if(els.parser_type.value === 'bailian_agent'){
    const c = parser?.config || {};
    els.p_bailian_apiKey.value = c.apiKey || '';
    els.p_bailian_agentId.value = c.agentId || DEFAULTS.bailianAgentId || '';
    showParserPanel('bailian');
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
  } else if(type === 'chatgpt_agent'){
    cfg = { apiKey: (els.p_chatgpt_apiKey.value||'').trim(), model:(els.p_chatgpt_model.value||'').trim() };
  } else if(type === 'bailian_agent'){
    cfg = { apiKey:(els.p_bailian_apiKey.value||'').trim(), agentId:(els.p_bailian_agentId.value||'').trim()};
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
  } else if(type === 'jiaowoban'){
    const map = {};
    if(els.p_jwb_title?.value.trim()) map.title = els.p_jwb_title.value.split(',').map(s=>s.trim()).filter(Boolean);
    if(els.p_jwb_startTime?.value.trim()) map.startTime = els.p_jwb_startTime.value.split(',').map(s=>s.trim()).filter(Boolean);
    if(els.p_jwb_endTime?.value.trim()) map.endTime = els.p_jwb_endTime.value.split(',').map(s=>s.trim()).filter(Boolean);
    if(els.p_jwb_location?.value.trim()) map.location = els.p_jwb_location.value.split(',').map(s=>s.trim()).filter(Boolean);
    if(els.p_jwb_status?.value.trim()) map.status = els.p_jwb_status.value.split(',').map(s=>s.trim()).filter(Boolean);
    if(els.p_jwb_id?.value.trim()) map.id = els.p_jwb_id.value.split(',').map(s=>s.trim()).filter(Boolean);
    if(Object.keys(map).length) cfg = { fieldMap: map };
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
    els._parsersCache = saved;
    await loadRenderParsers();
    closeParserModal();
  } catch(e){ alert('保存解析器失败: '+ e.message); }
}

function onParserTypeChange(){
  const t = els.parser_type?.value || 'zhipu_agent';
  if(t === 'zhipu_agent') showParserPanel('zhipu');
  else if(t === 'chatgpt_agent') showParserPanel('chatgpt');
  else if(t === 'bailian_agent') showParserPanel('bailian');
  else if(t === 'jiaowoban') showParserPanel('jiaowoban');
  else showParserPanel('json');
}

function showParserPanel(kind){
  const a = document.getElementById('parser_panel_zhipu');
  const b = document.getElementById('parser_panel_jsonmap');
  const d = document.getElementById('parser_panel_chatgpt');
  const e = document.getElementById('parser_panel_bailian');
  const f = document.getElementById('parser_panel_jiaowoban');
  if(a) a.style.display = kind==='zhipu' ? 'flex' : 'none';
  if(b) b.style.display = kind==='json' ? 'flex' : 'none';
  if(d) d.style.display = kind==='chatgpt' ? 'flex' : 'none';
  if(e) e.style.display = kind==='bailian' ? 'flex' : 'none';
  if(f) f.style.display = kind==='jiaowoban' ? 'flex' : 'none';
}

// ---------------- Servers management ----------------
function computeGoogleTokenStatus(cfg){
  const token = cfg?.token;
  if(token?.access_token){
    const now = Math.floor(Date.now()/1000);
    if(token.expires_at && token.expires_at <= now){
      return '授权已过期，请重新授权';
    }
    if(token.source === 'identity') return '已授权(浏览器身份)';
    return '已授权';
  }
  return '未授权';
}

function updateGoogleAuthUI(cfg){
  const isGoogle = (els.server_type?.value || 'radicale') === 'google';
  const saved = !!els._editingServerId;
  let effectiveCfg = cfg;
  if(!effectiveCfg){
    if(saved && Array.isArray(els._serversCache)){
      const found = els._serversCache.find(x=> x.id === els._editingServerId);
      effectiveCfg = found?.config || {};
    } else if(!saved && els._pendingGoogleConfig){
      effectiveCfg = els._pendingGoogleConfig;
    } else {
      effectiveCfg = {};
    }
  }
  if(els.btnGoogleAuthorize){
    if(isGoogle){
      // authorization requires terms acceptance
      const accepted = !!effectiveCfg.termsAcceptedAt || !!els.googleTermsAccept?.checked;
      els.btnGoogleAuthorize.disabled = !accepted;
      els.btnGoogleAuthorize.title = saved ? '' : (els._pendingGoogleConfig ? '已完成授权，可保存' : '未保存节点：可先授权获取令牌，再保存');
      els.btnGoogleAuthorize.style.display = '';
      if(els.btnGoogleForceConsent){ els.btnGoogleForceConsent.style.display=''; els.btnGoogleForceConsent.disabled=false; }
      if(els.btnGoogleRevoke){ els.btnGoogleRevoke.style.display=''; els.btnGoogleRevoke.disabled=false; }
      if(els.googleTermsHint){ els.googleTermsHint.style.display = accepted ? 'none':'block'; }
      if(els.googleTermsAccept){
        // reflect stored acceptance for saved nodes
        if(effectiveCfg.termsAcceptedAt){ els.googleTermsAccept.checked = true; }
      }
    }else{
      els.btnGoogleAuthorize.disabled = true;
      els.btnGoogleAuthorize.title = '';
      els.btnGoogleAuthorize.style.display = 'none';
      if(els.btnGoogleForceConsent){ els.btnGoogleForceConsent.style.display='none'; }
      if(els.btnGoogleRevoke){ els.btnGoogleRevoke.style.display='none'; }
      if(els.googleTermsHint){ els.googleTermsHint.style.display='none'; }
    }
  }
  if(!els.googleAuthStatus){
    return;
  }
  if(!isGoogle){
    els.googleAuthStatus.textContent = '';
    return;
  }
  const status = computeGoogleTokenStatus(effectiveCfg);
  const mode = effectiveCfg.oauthMode || effectiveCfg.token?.source || '';
  els.googleAuthStatus.textContent = mode ? (status + ' · ' + mode) : status;
  if(els.googleAuthPref && typeof effectiveCfg.authPref === 'string'){
    try { els.googleAuthPref.value = effectiveCfg.authPref; } catch(_){ /* ignore */ }
  }
  if(status === '未授权'){
    // 不再静默探测浏览器已登录令牌，保持真正的“未授权”初始状态，直到用户点击授权按钮。
  }
}

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
    els._serversCache = servers;
    const settings = await loadSettings();
    if(settings) els._settings = { ...els._settings, ...settings };
    let defaultServerId = settings?.selectedServerId;
    if(servers.length){
      if(!defaultServerId || !servers.some(s=> s.id === defaultServerId)){
        defaultServerId = servers[0].id;
        try {
          await saveSettings({ selectedServerId: defaultServerId });
          if(els._settings) els._settings.selectedServerId = defaultServerId;
        } catch(saveErr){ console.warn('保存默认服务器失败', saveErr); }
      }
    } else {
      defaultServerId = undefined;
    }
    renderServers(servers, defaultServerId);
    populateServerSelects(servers, defaultServerId);
  } catch(e){ console.error('加载服务器失败', e); }
}

function renderServers(servers, defaultServerId){
  if(!els.serverList) return;
  els.serverList.innerHTML='';
  const empty = els.serversEmpty;
  if(!servers.length){ if(empty) empty.style.display='block'; return; } else if(empty) empty.style.display='none';
  for(const s of servers){
    const li = document.createElement('li');
    li.style.cssText = 'border:1px solid #d4dbe6;padding:8px 10px;border-radius:10px;background:#fff;display:flex;flex-direction:column;gap:6px';
    const isDefault = defaultServerId && s.id === defaultServerId;
    const badge = isDefault ? '<span class="badge" style="margin-left:8px">默认</span>' : '';
    li.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">
        <span>${escapeHtml(s.name||'未命名')}${badge}</span>
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
      els._serversCache = list;
      await loadRenderServers();
    });
    els.serverList.appendChild(li);
  }
}

function populateServerSelects(servers, defaultServerId){
  if(els.task_serverId){
    const opts = (servers||[]).map(s=> {
      const isDefault = defaultServerId && s.id === defaultServerId;
      return `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.type)}${isDefault?' · 默认':''})</option>`;
    }).join('');
    els.task_serverId.innerHTML = opts;
    if(defaultServerId){ els.task_serverId.value = defaultServerId; }
  }
  if(els.defaultServerSelect){
    if(!servers.length){
      els.defaultServerSelect.innerHTML = '<option value="" disabled>暂无服务器</option>';
      els.defaultServerSelect.value = '';
      els.defaultServerSelect.disabled = true;
    } else {
      els.defaultServerSelect.disabled = false;
      els.defaultServerSelect.innerHTML = servers.map(s=>{
        const label = `${escapeHtml(s.name)} (${escapeHtml(s.type)})${defaultServerId && s.id === defaultServerId ? ' (默认)' : ''}`;
        return `<option value="${s.id}">${label}</option>`;
      }).join('');
      const targetId = defaultServerId && servers.some(s=> s.id === defaultServerId) ? defaultServerId : servers[0].id;
      els.defaultServerSelect.value = targetId;
    }
  }
}

function openServerModal(server, all){
  if(server){
    els._pendingGoogleConfig = null;
  } else if(!els._pendingGoogleConfig){
    els._pendingGoogleConfig = null;
  }
  els._editingServerId = server?.id || null;
  els.serverModalTitle.textContent = server? '编辑服务器节点':'新增服务器节点';
  els.server_name.value = server?.name || '';
  els.server_type.value = server?.type || 'radicale';
  const c = server?.config || {};
  if(els.s_default_calendar_name) els.s_default_calendar_name.value = c.defaultCalendarName || '';
  els.s_radicale_base.value = c.base || '';
  els.s_radicale_username.value = c.username || '';
  els.s_radicale_auth.value = c.auth || '';
  // No Google input fields; values come from manifest/defaults; authPref selectable
  if(els.googleRedirectHint){ els.googleRedirectHint.textContent = `https://${chrome.runtime.id}.chromiumapp.org/`; }
  if(els.googleAuthPref && c.authPref){ try { els.googleAuthPref.value = c.authPref; } catch(_){ } }
  updateGoogleAuthUI(c);
  els._serversCache = all || null;
  onServerTypeChange();
  els.serverModal.style.display='flex';
}

function closeServerModal(){
  els.serverModal.style.display='none';
  els._editingServerId=null;
  els._pendingGoogleConfig = null;
  updateGoogleAuthUI({});
}

async function submitServerForm(ev){
  ev.preventDefault();
  let cfg = {};
  const type = els.server_type.value;
  if(type === 'radicale'){
    cfg = { base: (els.s_radicale_base.value||'').trim(), username:(els.s_radicale_username.value||'').trim(), auth:(els.s_radicale_auth.value||'').trim() };
  } else if(type === 'google'){
    // Include pending token + authPref
    cfg = { ...(els._pendingGoogleConfig || {}) };
    if(els.googleAuthPref){ cfg.authPref = els.googleAuthPref.value || 'auto'; }
    // persist acceptance
    if(els.googleTermsAccept?.checked){
      if(!cfg.termsAcceptedAt){ cfg.termsAcceptedAt = Date.now(); }
    } else {
      // if user unchecked, we can choose to remove; for safety keep token gating until re-checked
      if(cfg.token){ delete cfg.token; }
      delete cfg.termsAcceptedAt;
    }
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
    els._serversCache = saved;
    els._editingServerId = id;
    await loadRenderServers();
    updateGoogleAuthUI(current?.config || cfg);
    els._pendingGoogleConfig = null;
    alert('服务器已保存');
  } catch(e){ alert('保存服务器失败: '+ e.message); }
}

function onServerTypeChange(){
  const t = els.server_type?.value || 'radicale';
  const a = document.getElementById('server_panel_radicale');
  const b = document.getElementById('server_panel_google');
  if(a) a.style.display = t==='radicale' ? 'flex':'none';
  if(b) b.style.display = t==='google' ? 'flex':'none';
  let cfg = {};
  if(els._editingServerId && Array.isArray(els._serversCache)){
    const found = els._serversCache.find(x=> x.id === els._editingServerId);
    if(found) cfg = found.config || {};
  }
  updateGoogleAuthUI(cfg);
}

async function onClickGoogleAuthorize(opts){
  const type = (els.server_type?.value||'radicale');
  if(type !== 'google') return;
  const savedId = els._editingServerId;
  const pref = els.googleAuthPref?.value || 'auto';
  // consent gating
  let accepted = false;
  if(savedId && Array.isArray(els._serversCache)){
    const cur = els._serversCache.find(x=> x.id === savedId);
    accepted = !!cur?.config?.termsAcceptedAt || !!els.googleTermsAccept?.checked;
  } else {
    accepted = !!els._pendingGoogleConfig?.termsAcceptedAt || !!els.googleTermsAccept?.checked;
  }
  if(!accepted){
    if(els.googleTermsHint){ els.googleTermsHint.style.display='block'; }
    alert('请先阅读并勾选同意说明后再授权。');
    return;
  }
  if(!opts?.forceConsent && pref === 'pkce'){ opts = { ...(opts||{}), forceConsent:true }; }
  if(opts?.forceConsent && pref === 'identity'){ opts.forceConsent = false; }
  if(savedId){
    try {
      if(els.googleAuthStatus) els.googleAuthStatus.textContent = '授权中…';
      const r = await chrome.runtime.sendMessage({ type:'AUTHORIZE_SERVER', id: savedId, forceConsent: !!opts?.forceConsent });
      if(!r?.ok){
        const msg = r.error||'授权失败';
        if(/client id|clientid|缺少\s*google\s*client\s*id/i.test(msg)){
          throw new Error(msg + '\n请在 manifest.json 的 oauth2.client_id 中配置 Google Client ID，或在服务器节点自定义。');
        }
        throw new Error(msg);
      }
  await loadRenderServers();
  const currentList = Array.isArray(els._serversCache) ? els._serversCache : await loadServers();
  const current = currentList.find(x=> x.id === savedId);
      updateGoogleAuthUI(current?.config || {});
      alert('Google 授权完成');
    } catch(e){
      if(Array.isArray(els._serversCache)){
        const current = els._serversCache.find(x=> x.id === savedId);
        updateGoogleAuthUI(current?.config || {});
      } else {
        updateGoogleAuthUI({});
      }
      alert('授权失败: ' + e.message);
    }
    return;
  }
  // Unsaved Google server: create temporary entry to reuse backend authorize flow
  let baseList = els._serversCache;
  try{
    if(!Array.isArray(baseList)) baseList = await loadServers();
  }catch(_){ baseList = []; }
  const cfg = els._pendingGoogleConfig ? { ...els._pendingGoogleConfig } : {};
  if(els.googleAuthPref){ cfg.authPref = els.googleAuthPref.value || 'auto'; }
  const defCal = (els.s_default_calendar_name?.value||'').trim();
  if(defCal) cfg.defaultCalendarName = defCal;
  const tempId = 'temp-google-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);
  const tempServer = { id: tempId, name: '(临时授权)', type:'google', config: cfg };
  try {
    await saveServers([...(baseList||[]), tempServer]);
    if(els.googleAuthStatus) els.googleAuthStatus.textContent = '授权中…';
  const r = await chrome.runtime.sendMessage({ type:'AUTHORIZE_SERVER', id: tempId, forceConsent: !!opts?.forceConsent });
    if(!r?.ok){
      const msg = r.error||'授权失败';
      if(/client id|clientid|缺少\s*google\s*client\s*id/i.test(msg)){
  throw new Error(msg + '\n请在 manifest.json 的 oauth2.client_id 中配置 Google Client ID，或在服务器节点自定义。');
      }
      throw new Error(msg);
    }
  const afterAuth = await loadServers();
  const tempSaved = afterAuth.find(x=> x.id === tempId);
    if(tempSaved){
      els._pendingGoogleConfig = {
        ...tempSaved.config,
        token: tempSaved.config?.token,
        oauthMode: tempSaved.config?.oauthMode,
        authPref: pref,
      };
    } else if(pref){
      // preserve chosen preference even if tempSaved missing
      els._pendingGoogleConfig = { ...(els._pendingGoogleConfig||{}), authPref: pref };
    }
    // remove temp node from storage
  const cleaned = afterAuth.filter(x=> x.id !== tempId);
  await saveServers(cleaned);
  els._serversCache = cleaned;
  await loadRenderServers();
  updateGoogleAuthUI(els._pendingGoogleConfig || {});
    alert('Google 授权完成，请点击保存以固定服务器配置');
  } catch(e){
    try {
  const cur = await loadServers();
  const cleaned = cur.filter(x=> x.id !== tempId);
  if(cleaned.length !== cur.length){ await saveServers(cleaned); }
  els._serversCache = cleaned;
    } catch(_){ /* ignore */ }
    els._pendingGoogleConfig = null;
    updateGoogleAuthUI({});
    alert('授权失败: ' + e.message);
  }
}

async function onClickGoogleRevoke(){
  const type = (els.server_type?.value||'radicale'); if(type !== 'google') return;
  const savedId = els._editingServerId; if(!savedId){ alert('请先保存服务器节点后再撤销'); return; }
  if(!confirm('确定撤销当前 Google 授权？这将删除本地令牌并尝试远程 revoke。')) return;
  try {
    if(els.googleAuthStatus) els.googleAuthStatus.textContent = '撤销中…';
    const r = await chrome.runtime.sendMessage({ type:'REVOKE_SERVER_AUTH', id: savedId });
    if(!r?.ok) throw new Error(r.error||'撤销失败');
    await loadRenderServers();
    const list = Array.isArray(els._serversCache)? els._serversCache : await loadServers();
    const current = list.find(x=> x.id === savedId);
    updateGoogleAuthUI(current?.config || {});
    alert('授权已撤销');
  } catch(e){
    alert('撤销失败: '+ e.message);
  }
}

async function saveDefaultServerSelection(){
  try{
    const id = (els.defaultServerSelect?.value || '').trim();
    await saveSettings({ selectedServerId: id || undefined });
    if(els._settings) els._settings.selectedServerId = id || undefined;
    await loadRenderServers();
  }catch(e){ console.error('保存默认服务器失败', e); }
}

async function saveDefaultParserSelection(){
  try{
    const id = (els.defaultParserSelect?.value || '').trim();
    await saveSettings({ selectedParserId: id || undefined });
    if(els._settings) els._settings.selectedParserId = id || undefined;
    await loadRenderParsers();
  }catch(e){ console.error('保存默认解析节点失败', e); }
}

// Compute missing optional host permissions and toggle banner
async function checkAndTogglePermBanner(){
  try{
    const [servers, parsers, tasksResp] = await Promise.all([
      loadServers(), loadParsers(), chrome.runtime.sendMessage({ type:'GET_PAGE_TASKS' })
    ]);
    const tasks = (tasksResp?.tasks)||[];
    const origins = [
      ...servers.flatMap(buildOriginsForServer),
      ...parsers.flatMap(buildOriginsForParser),
      ...tasks.flatMap(t => buildOriginsFromUrl(t?.modeConfig?.url||'').concat(buildOriginsFromUrl(t?.modeConfig?.warmupUrl||'')))
    ];
    const uniq = Array.from(new Set(origins.filter(Boolean)));
    if(!uniq.length){ if(els.permBanner) els.permBanner.style.display='none'; return; }
    const hasAll = await chrome.permissions.contains({ origins: uniq });
    if(els.permBanner) els.permBanner.style.display = hasAll ? 'none':'block';
  }catch(e){ console.warn('权限检查失败', e); }
}

async function authorizeMissing(){
  try{
    const [servers, parsers, tasksResp] = await Promise.all([
      loadServers(), loadParsers(), chrome.runtime.sendMessage({ type:'GET_PAGE_TASKS' })
    ]);
    const tasks = (tasksResp?.tasks)||[];
    const origins = [
      ...servers.flatMap(buildOriginsForServer),
      ...parsers.flatMap(buildOriginsForParser),
      ...tasks.flatMap(t => buildOriginsFromUrl(t?.modeConfig?.url||'').concat(buildOriginsFromUrl(t?.modeConfig?.warmupUrl||'')))
    ];
    const res = await ensureHostPermissions(origins, false);
    if(res.ok){ await checkAndTogglePermBanner(); }
  }catch(e){ alert('授权失败: '+ e.message); }
}

// Global one-click authorization: gather all needed origins across servers/parsers and request once
async function authorizeAll(){
  try{
    const [servers, parsers, tasksResp] = await Promise.all([
      loadServers(), loadParsers(), chrome.runtime.sendMessage({ type:'GET_PAGE_TASKS' })
    ]);
    const tasks = (tasksResp?.tasks)||[];
    const origins = [
      ...servers.flatMap(buildOriginsForServer),
      ...parsers.flatMap(buildOriginsForParser),
      ...tasks.flatMap(t => buildOriginsFromUrl(t?.modeConfig?.url||'').concat(buildOriginsFromUrl(t?.modeConfig?.warmupUrl||'')))
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
  if(parser.type === 'zhipu_agent' || parser.type === 'chatgpt_agent' || parser.type === 'bailian_agent'){
    // Fallback to provider defaults when apiUrl not explicitly set on the node
    let apiUrl = parser.config?.apiUrl || '';
    if(!apiUrl){
      if(parser.type === 'zhipu_agent') apiUrl = DEFAULTS.llmApiUrl;
      else if(parser.type === 'chatgpt_agent') apiUrl = DEFAULTS.openaiApiUrl;
      else if(parser.type === 'bailian_agent') apiUrl = DEFAULTS.bailianApiUrl;
    }
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
