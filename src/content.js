import { allowedPages, escapeHTML } from './shared.js';

function log(...a) {
  console.log('[SJTU Content]', ...a);
}

function isAllowed() {
  const current = location.hostname + location.pathname;
  return allowedPages.some((p) => current.includes(p));
}

// Toast & modal base styles
const CSS = `
#sjtu-toast-root { position:fixed; right:18px; bottom:86px; z-index:999999; display:flex; flex-direction:column; gap:10px; font-family:system-ui,Segoe UI; }
.sjtu-toast { min-width:240px; max-width:420px; padding:10px 14px; border-radius:10px; background:#f2f7ff; box-shadow:0 6px 18px rgba(9,30,66,.12); font-size:13px; transition:opacity .4s; }
`;

function injectBase() {
  if (!document.getElementById('sjtu-base-style')) {
    const s = document.createElement('style');
    s.id = 'sjtu-base-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  if (!document.getElementById('sjtu-toast-root')) {
    const r = document.createElement('div');
    r.id = 'sjtu-toast-root';
    document.body.appendChild(r);
  }
}

export function showToast(text) {
  injectBase();
  const root = document.getElementById('sjtu-toast-root');
  if (!root) return;
  const t = document.createElement('div');
  t.className = 'sjtu-toast';
  t.innerHTML = `<div style="font-weight:600">${escapeHTML(text)}</div>`;
  root.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 400);
  }, 6000);
}

function buildParseModal(initialSel) {
  const id = 'sjtu-parse-modal';
  const ex = document.getElementById(id);
  if (ex) ex.remove();

  const wrap = document.createElement('div');
  wrap.id = id;
  wrap.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:999999',
    'background:rgba(0,0,0,.35)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-family:system-ui,Segoe UI',
  ].join(';');

  wrap.innerHTML = `
    <div style="background:#fff;padding:20px;width:660px;max-width:94%;border-radius:14px;box-shadow:0 20px 50px rgba(9,30,66,.18);display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0;font-size:18px">LLM 日程解析</h2>
        <button id="sjtu-close" style="background:transparent;border:1px solid #ddd;border-radius:8px;padding:4px 10px;cursor:pointer">关闭</button>
      </div>
      <textarea id="sjtu-parse-text" rows="8" style="width:100%;resize:vertical;padding:10px;border-radius:10px;border:1px solid #e1e6f2" placeholder="例如：明天下午3点-5点在创业大楼开产品评审会"></textarea>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="sjtu-submit" style="background:#0b74de;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer">解析并上传</button>
      </div>
    </div>`;

  document.body.appendChild(wrap);
  wrap.querySelector('#sjtu-close').onclick = () => wrap.remove();
  const ta = wrap.querySelector('#sjtu-parse-text');
  ta.value = initialSel || '';

  const submit = () => {
    const txt = ta.value.trim();
    if (!txt) {
      showToast('请输入要解析的文本');
      return;
    }
    chrome.runtime.sendMessage({ type: 'PARSE_LLM', text: txt }, (resp) => {
      if (!resp?.ok) showToast('解析失败: ' + resp?.error);
      else showToast('提交解析成功，事件数量 ' + resp.count);
    });
    wrap.remove();
  };
  wrap.querySelector('#sjtu-submit').onclick = submit;
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') submit();
    if (e.key === 'Escape') wrap.remove();
  });
}

// Runtime message handling
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'SJTU_CAL_OPEN_PARSE_MODAL_FROM_SELECTION') {
    const sel = (window.getSelection()?.toString() || '').trim();
    buildParseModal(sel);
    sendResponse({ ok: true });
  }
  if (msg?.type === 'SJTU_CAL_OPEN_PARSE_MODAL') {
    buildParseModal(msg.initialText || '');
    sendResponse({ ok: true });
  }
  if (msg?.type === 'SJTU_CAL_TOAST') {
    showToast(msg.text);
  }
  if (msg?.type === 'SJTU_CAL_CAPTURE_TEXT') {
    try {
      const bodyText = document.body ? document.body.innerText.slice(0, 200000) : '';
      sendResponse({ ok: true, text: bodyText });
    } catch(e){
      sendResponse({ ok:false, error: e.message });
    }
  }
});

// Note: no global keyboard shortcuts are registered here to minimize injection behavior.

function init() {
  injectBase();
  log('content loaded');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
