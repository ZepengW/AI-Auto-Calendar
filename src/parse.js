import { loadSettings, DEFAULTS, parseLLMTime } from './shared.js';

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
    const res = await chrome.runtime.sendMessage({ type:'UPLOAD_EVENTS', events: normalized });
    if(!res?.ok) throw new Error(res?.error || '上传失败');
    setUploadStatus('上传成功：'+ normalized.length +' 条','success-box');
  } catch(e){
    setUploadStatus('上传失败：'+ e.message,'error-box');
  }
}

function bind(){
  qs('btnParse').addEventListener('click', ()=>parseLLM(qs('rawInput').value));
  qs('btnClear').addEventListener('click', ()=>{ qs('rawInput').value=''; setStatus(''); });
  qs('btnMock').addEventListener('click', ()=>{
    qs('rawInput').value = `明天下午3点-5点在软件学院220会议室开AI项目评审会\n9月18日全天 外聘专家对接\n每周三 9:00-10:00 组会（连续四周）`;
  });
  qs('btnUpload').addEventListener('click', uploadSelected);
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
}

bind();