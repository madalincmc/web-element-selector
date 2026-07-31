const fields = {
  cssRelative: document.getElementById('cssRel'),
  cssAbsolute: document.getElementById('cssAbs'),
  xpathRelative: document.getElementById('xpRel'),
  xpathAbsolute: document.getElementById('xpAbs'),
  cssContains: document.getElementById('cssContains'),
  xpathText: document.getElementById('xpText'),
  roleSel: document.getElementById('roleSel'),
  pwLocators: document.getElementById('pwLocators')
};

const FIELD_LABELS = {
  cssRelative: 'CSS — Relative',
  cssAbsolute: 'CSS — Absolute',
  xpathRelative: 'XPath — Relative',
  xpathAbsolute: 'XPath — Absolute',
  cssContains: 'CSS (attr contains)',
  xpathText: 'XPath (text contains)',
  roleSel: 'ARIA/Role selector',
  pwLocators: 'Playwright locators'
};

let currentTabId = null;
let localHistory = [];
let currentPayload = null;

function populateFrameworkSelect(defaultFramework, defaultLanguage) {
  const fwSelect = document.getElementById('frameworkSelect');
  const langSelect = document.getElementById('languageSelect');
  fwSelect.innerHTML = '';
  WESGSnippets.FRAMEWORKS.forEach((fw) => {
    const opt = document.createElement('option');
    opt.value = fw.id;
    opt.textContent = fw.label;
    fwSelect.appendChild(opt);
  });
  if (defaultFramework) fwSelect.value = defaultFramework;

  function populateLanguages() {
    const fw = WESGSnippets.FRAMEWORKS.find((f) => f.id === fwSelect.value) || WESGSnippets.FRAMEWORKS[0];
    langSelect.innerHTML = '';
    fw.languages.forEach((lang) => {
      const opt = document.createElement('option');
      opt.value = lang.id;
      opt.textContent = lang.label;
      langSelect.appendChild(opt);
    });
    if (defaultLanguage && fw.languages.some((l) => l.id === defaultLanguage)) langSelect.value = defaultLanguage;
  }
  populateLanguages();
  fwSelect.addEventListener('change', () => { populateLanguages(); updateSnippet(); });
  langSelect.addEventListener('change', updateSnippet);
}

function updateSnippet() {
  const box = document.getElementById('snippetCode');
  if (!currentPayload) { box.value = ''; return; }
  const fw = document.getElementById('frameworkSelect').value;
  const lang = document.getElementById('languageSelect').value;
  box.value = WESGSnippets.generate(fw, lang, currentPayload) || '';
}

function showError(msg) {
  const el = document.getElementById('errorBanner');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function sendMessageSafe(msg, cb) {
  try {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        if (cb) cb(null);
        return;
      }
      if (cb) cb(res);
    });
  } catch (e) {
    showError(e.message);
  }
}

function fillAll(payload) {
  currentPayload = payload;
  Object.keys(fields).forEach((key) => {
    fields[key].value = payload[key] || '';
  });
  updateSnippet();

  document.querySelectorAll('.card[data-field]').forEach((card) => {
    card.classList.toggle('recommended', card.dataset.field === payload.recommended);
  });

  const frameInfo = document.getElementById('frameInfo');
  if (payload.frameId) {
    frameInfo.textContent = `From frame #${payload.frameId}${payload.frameUrl ? ': ' + payload.frameUrl : ''}`;
    frameInfo.style.display = 'block';
  } else {
    frameInfo.style.display = 'none';
  }

  const shadowInfo = document.getElementById('shadowInfo');
  if (payload.shadowInfo) {
    shadowInfo.textContent = payload.shadowInfo + (payload.shadowPath ? ` Shadow path: ${payload.shadowPath}` : '');
    shadowInfo.style.display = 'block';
  } else {
    shadowInfo.style.display = 'none';
  }
}

function copyFrom(id) {
  const el = document.getElementById(id);
  const text = el && el.value ? el.value.trim() : '';
  if (!text) return;
  navigator.clipboard.writeText(text);
}

function copyAll() {
  const text = Object.keys(fields)
    .map((key) => `${FIELD_LABELS[key]}:\n${fields[key].value || '(empty)'}`)
    .join('\n\n');
  navigator.clipboard.writeText(text);
}

function setInspect(enabled) {
  if (!currentTabId) return;
  sendMessageSafe({ action: 'toggleInspect', tabId: currentTabId, enabled });
}

function historyLabel(entry) {
  const source = entry.cssRelative || entry.xpathAbsolute || entry.cssAbsolute || '';
  return source.length > 48 ? source.slice(0, 48) + '…' : (source || '(unlabeled element)');
}

function renderHistory(list) {
  localHistory = list || [];
  document.getElementById('historyCount').textContent = String(localHistory.length);
  const ul = document.getElementById('historyList');
  ul.innerHTML = '';
  localHistory.forEach((entry) => {
    const li = document.createElement('li');
    const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
    li.appendChild(document.createTextNode(historyLabel(entry)));
    const meta = document.createElement('span');
    meta.className = 'hist-meta';
    meta.textContent = time;
    li.appendChild(meta);
    li.addEventListener('click', () => fillAll(entry));
    ul.appendChild(li);
  });
}

function loadHistory(cb) {
  if (!currentTabId) return;
  sendMessageSafe({ action: 'getHistory', tabId: currentTabId }, (res) => {
    renderHistory(res || []);
    if (cb) cb(res || []);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Live updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'elementSelected') {
      fillAll(message);
      localHistory.unshift(message);
      renderHistory(localHistory);
    }
  });

  // Copy buttons
  document.querySelectorAll('.copy').forEach((btn) => {
    btn.addEventListener('click', () => copyFrom(btn.dataset.target));
  });
  document.getElementById('copyAllBtn').addEventListener('click', copyAll);

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('copySnippetBtn').addEventListener('click', () => {
    const text = document.getElementById('snippetCode').value;
    if (text) navigator.clipboard.writeText(text);
  });

  document.getElementById('panelBtn').addEventListener('click', () => {
    if (!currentTabId) return;
    try {
      chrome.sidePanel.open({ tabId: currentTabId });
    } catch (e) {
      showError('Could not open the side panel: ' + e.message);
    }
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    if (!currentTabId) return;
    sendMessageSafe({ action: 'requestSelectorUpdate', tabId: currentTabId });
  });

  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (!currentTabId) return;
    sendMessageSafe({ action: 'clearHistory', tabId: currentTabId }, () => renderHistory([]));
  });

  // Validate all
  document.getElementById('validateBtn').addEventListener('click', () => {
    if (!currentTabId) return;
    const tabId = currentTabId;
    const selectors = [
      ['CSS Relative', fields.cssRelative.value, 'css'],
      ['CSS Absolute', fields.cssAbsolute.value, 'css'],
      ['XPath Relative', fields.xpathRelative.value, 'xpath'],
      ['XPath Absolute', fields.xpathAbsolute.value, 'xpath'],
      ['CSS Contains', fields.cssContains.value, 'css'],
      ['XPath Text', fields.xpathText.value, 'xpath']
    ];
    chrome.scripting.executeScript({
      target: { tabId },
      func: (items) => {
        function validate(sel, type) {
          try {
            if (!sel) return -2;
            if (type === 'css') return document.querySelectorAll(sel).length;
            const res = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            return res.snapshotLength;
          } catch (e) { return -1; }
        }
        return items.map(([label, sel, type]) => [label, validate(sel, type)]);
      },
      args: [selectors]
    }, (results) => {
      if (chrome.runtime.lastError) { showError(chrome.runtime.lastError.message); return; }
      const rows = (results && results[0] && results[0].result) || [];
      const div = document.getElementById('validationResult');
      div.innerHTML = rows.map(([label, n]) => {
        if (n === -2) return `<div class='warn'>${label}: empty</div>`;
        if (n === -1) return `<div class='err'>${label}: invalid</div>`;
        if (n === 0) return `<div class='err'>${label}: 0 matches</div>`;
        if (n === 1) return `<div class='ok'>${label}: 1 match</div>`;
        return `<div class='warn'>${label}: ${n} matches</div>`;
      }).join('');
    });
  });

  // Inspect toggle
  const toggle = document.getElementById('inspectToggle');
  toggle.addEventListener('change', (e) => setInspect(e.target.checked));

  // Bootstrap
  chrome.storage.sync.get(['wesg_default_framework', 'wesg_default_language'], (res) => {
    populateFrameworkSelect(res.wesg_default_framework, res.wesg_default_language);
    updateSnippet();
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs && tabs[0] && tabs[0].id;
    if (!tabId) return;
    currentTabId = tabId;

    sendMessageSafe({ action: 'getInspectState', tabId }, (enabled) => {
      toggle.checked = !!enabled;
    });

    loadHistory((res) => {
      if (res && res.length) fillAll(res[0]);
    });
  });
});
