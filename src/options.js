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

  const cfg = await loadSettings();
  const mapping = {
    radicalBase: 'radicalBase',
    radicalUsername: 'radicalUsername',
    radicalAuth: 'radicalAuth',
    autoSyncMinutes: 'autoSyncMinutes',
    dateWindowDays: 'dateWindowDays',
    enableNotifications: 'enableNotifications',
    llmProvider: 'llmProvider',
  };
  Object.entries(mapping).forEach(([k, id]) => {
    const el = els[id];
    if(!el) return;
    if(k === 'enableNotifications') el.value = cfg[k] ? 'true':'false';
    else if(k === 'llmProvider') el.value = cfg.llmProvider || 'zhipu_agent';
    else el.value = cfg[k] ?? DEFAULTS[k];
  });
  if(els.lastSync) els.lastSync.textContent = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'n/a';
  fillProvider(cfg);

  els.llmProvider?.addEventListener('change', () => fillProvider({ llmProvider: els.llmProvider.value }));
  els.saveBtn?.addEventListener('click', saveAll);
  els.syncNow?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'SYNC_NOW' }));
}

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

document.addEventListener('DOMContentLoaded', init);
