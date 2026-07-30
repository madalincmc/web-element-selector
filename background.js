// Background: per-tab selector history, context menu, keyboard shortcut, frame-aware relaying.

const HISTORY_LIMIT = 25;
const history = {}; // tabId -> array of entries, newest first; backed by chrome.storage.local

function historyKey(tabId) { return 'wesg_hist_' + tabId; }
function inspectKey(tabId) { return 'wesg_inspect_' + tabId; }

function saveHistory(tabId) {
  chrome.storage.local.set({ [historyKey(tabId)]: history[tabId] || [] });
}

// Inspect state lives in storage.session (not a plain var) because the MV3
// service worker can be killed/restarted at any time, which would otherwise
// desync it from the state the content script still holds.
async function getInspecting(tabId) {
  const res = await chrome.storage.session.get(inspectKey(tabId));
  return !!res[inspectKey(tabId)];
}

async function setBadge(tabId, enabled) {
  await chrome.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
  if (enabled) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
}

async function toggleInspectForTab(tabId, enabled) {
  if (enabled) await chrome.storage.session.set({ [inspectKey(tabId)]: true });
  else await chrome.storage.session.remove(inspectKey(tabId));
  try { await chrome.tabs.sendMessage(tabId, { action: 'toggleInspect', enabled }); } catch (e) {}
  await setBadge(tabId, enabled);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  delete history[tabId];
  chrome.storage.local.remove(historyKey(tabId));
  chrome.storage.session.remove(inspectKey(tabId));
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'wesg-inspect',
    title: 'Generate selectors for this element',
    contexts: ['all']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'wesg-inspect' || !tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'generateFromContextTarget' }, { frameId: info.frameId }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-inspect') return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) return;
  const enabled = await getInspecting(tab.id);
  await toggleInspectForTab(tab.id, !enabled);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  if (message.action === 'elementSelected') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const payload = Object.assign({}, message);
    delete payload.action;
    payload.timestamp = Date.now();
    payload.frameId = sender.frameId;
    payload.frameUrl = sender.url;
    if (tabId) {
      const list = history[tabId] || [];
      list.unshift(payload);
      if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
      history[tabId] = list;
      saveHistory(tabId);
    }
    chrome.runtime.sendMessage(Object.assign({ action: 'elementSelected' }, payload)).catch(() => {});
    return;
  }

  if (message.action === 'toggleInspect') {
    if (!message.tabId) { sendResponse(false); return; }
    toggleInspectForTab(message.tabId, !!message.enabled).then(() => sendResponse(true));
    return true;
  }

  if (message.action === 'getInspectState') {
    if (!message.tabId) { sendResponse(false); return; }
    getInspecting(message.tabId).then(sendResponse);
    return true;
  }

  if (message.action === 'requestSelectorUpdate') {
    if (message.tabId) chrome.tabs.sendMessage(message.tabId, message).catch(() => {});
    return;
  }

  if (message.action === 'getHistory') {
    const tabId = message.tabId;
    if (!tabId) { sendResponse([]); return; }
    if (history[tabId]) { sendResponse(history[tabId]); return; }
    chrome.storage.local.get(historyKey(tabId), (res) => {
      sendResponse(res[historyKey(tabId)] || []);
    });
    return true;
  }

  if (message.action === 'clearHistory') {
    const tabId = message.tabId;
    if (tabId) {
      delete history[tabId];
      chrome.storage.local.remove(historyKey(tabId));
    }
    sendResponse(true);
    return true;
  }
});
