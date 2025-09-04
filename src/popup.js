// Popup script (MV3 - external file, no inline JS)
function qs(id){ return document.getElementById(id); }

function openOptions(){
  if(chrome.runtime.openOptionsPage){
    chrome.runtime.openOptionsPage();
  } else {
    chrome.tabs.create({ url: 'options.html' });
  }
}

function triggerSync(){
  chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
  const status = qs('status');
  if(status) status.textContent = '已发送同步指令';
}

function openParseModalBlank(){
  chrome.tabs.create({ url: 'parse.html' });
}

function bind(){
  qs('openOptions')?.addEventListener('click', openOptions);
  qs('syncNow')?.addEventListener('click', triggerSync);
  qs('parseText')?.addEventListener('click', openParseModalBlank);
}

document.addEventListener('DOMContentLoaded', bind);
