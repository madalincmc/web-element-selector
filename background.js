// Background: per-tab selector history, context menu, keyboard shortcut, frame-aware relaying.

const HISTORY_LIMIT = 25;
const history = {}; // tabId -> array of entries, newest first; backed by chrome.storage.local

function historyKey(tabId) { return 'wesg_hist_' + tabId; }
function inspectKey(tabId) { return 'wesg_inspect_' + tabId; }
function scanKey(tabId) { return 'wesg_scan_' + tabId; }

// Full-page scan sessions, keyed by tabId. Cleared on completion/timeout/tab close.
const scanSessions = {};
const SCAN_TIMEOUT_MS = 15000;

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
  clearScanSession(tabId);
  chrome.storage.session.remove(scanKey(tabId));
});

// ---------------------------------------------------------------------------
// Full-page scan orchestration: enumerate every frame in the tab, ask each
// frame's content script to scan itself (content.js runs independently per
// frame thanks to all_frames:true, which also reaches cross-origin iframes
// that a single frame's own DOM access could never see), and aggregate.
// ---------------------------------------------------------------------------

function clearScanSession(tabId) {
  const session = scanSessions[tabId];
  if (session && session.timeoutHandle) clearTimeout(session.timeoutHandle);
  delete scanSessions[tabId];
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function finishScan(tabId, scanId, timedOut) {
  const session = scanSessions[tabId];
  if (!session || session.scanId !== scanId || session.done) return;
  session.done = true;
  if (session.timeoutHandle) clearTimeout(session.timeoutHandle);

  chrome.storage.session.set({
    [scanKey(tabId)]: { entries: session.entries, truncated: session.truncated, timestamp: Date.now() }
  });

  broadcast({
    action: 'scanPageComplete',
    scanId,
    tabId,
    totalEntries: session.entries.length,
    truncated: session.truncated,
    timedOut: !!timedOut
  });
  clearScanSession(tabId);
}

function maybeFinishScan(tabId, scanId) {
  const session = scanSessions[tabId];
  if (!session || session.scanId !== scanId) return;
  if (session.receivedFrames >= session.expectedFrames) finishScan(tabId, scanId, false);
}

async function startPageScan(tabId, options) {
  clearScanSession(tabId);
  const scanId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let frames = [{ frameId: 0 }];
  try {
    const all = await chrome.webNavigation.getAllFrames({ tabId });
    if (all && all.length) frames = all;
  } catch (e) {}

  const session = {
    scanId, entries: [], truncated: false, done: false,
    expectedFrames: frames.length, receivedFrames: 0, timeoutHandle: null
  };
  scanSessions[tabId] = session;

  broadcast({ action: 'scanPageStarted', scanId, tabId, expectedFrames: frames.length });

  session.timeoutHandle = setTimeout(() => finishScan(tabId, scanId, true), SCAN_TIMEOUT_MS);

  frames.forEach((frame) => {
    chrome.tabs.sendMessage(tabId, { action: 'scanPage', options, scanId }, { frameId: frame.frameId }).catch(() => {
      const s = scanSessions[tabId];
      if (!s || s.scanId !== scanId) return;
      s.receivedFrames++;
      maybeFinishScan(tabId, scanId);
    });
  });

  return scanId;
}

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

  if (message.action === 'startPageScan') {
    if (!message.tabId) { sendResponse(null); return; }
    startPageScan(message.tabId, message.options).then(sendResponse);
    return true;
  }

  // Sent by content.js once its (per-frame) scan finishes.
  if (message.action === 'scanPageResult') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const session = tabId != null ? scanSessions[tabId] : null;
    if (!session || session.scanId !== message.scanId || session.done) return;

    const newEntries = (message.entries || []).map((e) => Object.assign({}, e, {
      frameId: sender.frameId,
      frameUrl: sender.url
    }));
    session.entries = session.entries.concat(newEntries);
    if (message.truncated) session.truncated = true;
    session.receivedFrames++;

    broadcast({
      action: 'scanPageProgress',
      scanId: message.scanId,
      tabId,
      newEntries,
      receivedFrames: session.receivedFrames,
      expectedFrames: session.expectedFrames,
      totalSoFar: session.entries.length
    });

    maybeFinishScan(tabId, message.scanId);
    return;
  }

  if (message.action === 'getScanResults') {
    const tabId = message.tabId;
    if (!tabId) { sendResponse(null); return; }
    chrome.storage.session.get(scanKey(tabId), (res) => sendResponse(res[scanKey(tabId)] || null));
    return true;
  }

  if (message.action === 'clearScanResults') {
    const tabId = message.tabId;
    if (tabId) {
      clearScanSession(tabId);
      chrome.storage.session.remove(scanKey(tabId));
    }
    sendResponse(true);
    return true;
  }

  if (message.action === 'highlightScanElement') {
    if (message.tabId) {
      chrome.tabs.sendMessage(message.tabId, { action: 'highlightScanElement', index: message.index, scroll: message.scroll }, { frameId: message.frameId || 0 }).catch(() => {});
    }
    return;
  }

  if (message.action === 'clearScanHighlight') {
    if (message.tabId) {
      chrome.tabs.sendMessage(message.tabId, { action: 'clearScanHighlight' }, { frameId: message.frameId || 0 }).catch(() => {});
    }
    return;
  }
});
