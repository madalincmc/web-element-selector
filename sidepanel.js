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

const CATEGORY_LABELS = {
  testId: 'Test-id', form: 'Form', button: 'Button', link: 'Link',
  input: 'Input', heading: 'Heading', landmark: 'Role', image: 'Image', other: 'Other'
};

let currentTabId = null;
let allEntries = [];
const rowsByKey = new Map(); // entryKey -> { entry, rowEl, snippetCodeEl, expanded }
const selectedKeys = new Set();
let lastHighlightKey = null;
let currentScanId = null;

function entryKey(e) { return `${e.frameId}:${e.index}`; }

function showError(msg) {
  const el = document.getElementById('errorBanner');
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

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- framework/language pickers -----------------------------------------
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
  fwSelect.value = defaultFramework || WESGSnippets.FRAMEWORKS[0].id;
  if (fwSelect.value !== defaultFramework) fwSelect.selectedIndex = 0;

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
  fwSelect.addEventListener('change', () => { populateLanguages(); updateAllSnippets(); });
  langSelect.addEventListener('change', updateAllSnippets);
}

function currentFramework() { return document.getElementById('frameworkSelect').value; }
function currentLanguage() { return document.getElementById('languageSelect').value; }

function updateAllSnippets() {
  const fw = currentFramework();
  const lang = currentLanguage();
  rowsByKey.forEach(({ entry, snippetCodeEl }) => {
    if (!snippetCodeEl) return;
    snippetCodeEl.textContent = WESGSnippets.generate(fw, lang, entry) || '(no snippet available for this element)';
  });
}

// ---- filters / scan options ----------------------------------------------
function gatherScanOptions() {
  const categories = {};
  document.querySelectorAll('#filtersPanel input[data-cat]').forEach((cb) => { categories[cb.dataset.cat] = cb.checked; });
  const customSelectors = document.getElementById('customSelectors').value
    .split(',').map((s) => s.trim()).filter(Boolean);
  return {
    categories,
    visibleOnly: document.getElementById('visibleOnly').checked,
    maxElements: Number(document.getElementById('maxElements').value) || 500,
    customSelectors
  };
}

function saveScanDefaults() {
  const opts = gatherScanOptions();
  chrome.storage.sync.set({
    wesg_scan_categories: opts.categories,
    wesg_scan_max: opts.maxElements,
    wesg_default_framework: currentFramework(),
    wesg_default_language: currentLanguage()
  });
}

// ---- rendering -------------------------------------------------------------
function matchesSearch(entry, query) {
  if (!query) return true;
  const haystack = [
    entry.label, entry.locator && entry.locator.tag, entry.cssRelative, entry.xpathRelative,
    entry.category, entry.frameUrl
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

function buildDetailGrid(entry) {
  const grid = document.createElement('div');
  grid.className = 'detailGrid';
  Object.keys(FIELD_LABELS).forEach((key) => {
    if (!entry[key]) return;
    const row = document.createElement('div');
    row.className = 'detailField';
    const k = document.createElement('span'); k.className = 'k'; k.textContent = FIELD_LABELS[key];
    const v = document.createElement('span'); v.className = 'v'; v.textContent = entry[key];
    row.appendChild(k); row.appendChild(v);
    grid.appendChild(row);
  });
  if (entry.frameUrl) {
    const row = document.createElement('div');
    row.className = 'detailField';
    const k = document.createElement('span'); k.className = 'k'; k.textContent = 'Frame';
    const v = document.createElement('span'); v.className = 'v'; v.textContent = entry.frameUrl;
    row.appendChild(k); row.appendChild(v);
    grid.appendChild(row);
  }
  return grid;
}

function createRow(entry) {
  const tpl = document.getElementById('rowTemplate');
  const node = tpl.content.firstElementChild.cloneNode(true);
  const key = entryKey(entry);

  const badge = node.querySelector('.catBadge');
  badge.textContent = CATEGORY_LABELS[entry.category] || entry.category;
  badge.classList.add(entry.category);

  node.querySelector('.entryLabel').textContent = entry.label || '(no text)';
  node.querySelector('.entryTag').textContent = `<${(entry.locator && entry.locator.tag) || '?'}>`;
  node.querySelector('.entrySelector').textContent = entry[entry.recommended] || entry.cssRelative || '';

  const detail = node.querySelector('.entryDetail');
  const head = node.querySelector('.entryHead');
  const checkbox = node.querySelector('.entrySelect');
  checkbox.checked = selectedKeys.has(key);

  head.addEventListener('click', (e) => {
    if (e.target === checkbox) return;
    const isOpen = detail.style.display !== 'none';
    detail.style.display = isOpen ? 'none' : 'block';
  });

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selectedKeys.add(key); else selectedKeys.delete(key);
    updateBulkBar();
  });

  node.addEventListener('mouseenter', () => highlightEntry(entry));
  node.addEventListener('mouseleave', () => clearHighlight());

  const detailGrid = node.querySelector('.detailGrid');
  detailGrid.replaceWith(buildDetailGrid(entry));

  const snippetCodeEl = node.querySelector('.snippetCode');
  snippetCodeEl.textContent = WESGSnippets.generate(currentFramework(), currentLanguage(), entry) || '(no snippet available for this element)';
  node.querySelector('.copySnippetBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(snippetCodeEl.textContent);
  });

  rowsByKey.set(key, { entry, rowEl: node, snippetCodeEl });
  return node;
}

function renderList() {
  const query = document.getElementById('searchBox').value.trim().toLowerCase();
  const list = document.getElementById('resultsList');
  list.innerHTML = '';
  rowsByKey.clear();

  const filtered = allEntries.filter((e) => matchesSearch(e, query));
  filtered.forEach((entry) => list.appendChild(createRow(entry)));

  document.getElementById('resultCount').textContent = `${filtered.length} of ${allEntries.length} elements`;
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  document.getElementById('selectedCount').textContent = `${selectedKeys.size} selected`;
  bar.style.display = selectedKeys.size ? 'flex' : 'none';
}

function highlightEntry(entry) {
  clearHighlight();
  lastHighlightKey = entryKey(entry);
  sendMessageSafe({ action: 'highlightScanElement', tabId: currentTabId, frameId: entry.frameId, index: entry.index, scroll: false });
}

function clearHighlight() {
  if (!lastHighlightKey) return;
  const [frameId] = lastHighlightKey.split(':');
  sendMessageSafe({ action: 'clearScanHighlight', tabId: currentTabId, frameId: Number(frameId) });
  lastHighlightKey = null;
}

// ---- scan lifecycle --------------------------------------------------------
function setScanStatus(text) { document.getElementById('scanStatus').textContent = text; }

function startScan() {
  allEntries = [];
  selectedKeys.clear();
  renderList();
  document.getElementById('scanBtn').disabled = true;
  setScanStatus('Starting…');
  saveScanDefaults();
  sendMessageSafe({ action: 'startPageScan', tabId: currentTabId, options: gatherScanOptions() }, (scanId) => {
    currentScanId = scanId;
  });
}

function applyScanResults(res) {
  allEntries = (res && res.entries) || [];
  renderList();
  const truncatedNote = document.getElementById('truncatedNote');
  truncatedNote.style.display = res && res.truncated ? 'block' : 'none';
}

function loadCachedScan(tabId) {
  sendMessageSafe({ action: 'getScanResults', tabId }, (res) => {
    if (res) applyScanResults(res);
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.action || message.tabId !== currentTabId) return;

  if (message.action === 'scanPageStarted') {
    setScanStatus(`Scanning… 0/${message.expectedFrames} frames`);
    return;
  }

  if (message.action === 'scanPageProgress') {
    allEntries = allEntries.concat(message.newEntries || []);
    renderList();
    setScanStatus(`Scanning… ${message.receivedFrames}/${message.expectedFrames} frames, ${message.totalSoFar} elements`);
    return;
  }

  if (message.action === 'scanPageComplete') {
    document.getElementById('scanBtn').disabled = false;
    setScanStatus(message.timedOut
      ? `Done (some frames timed out) — ${message.totalEntries} elements`
      : `Done — ${message.totalEntries} elements`);
    document.getElementById('truncatedNote').style.display = message.truncated ? 'block' : 'none';
    return;
  }
});

// ---- bulk actions ----------------------------------------------------------
function selectedEntries() {
  return allEntries.filter((e) => selectedKeys.has(entryKey(e)));
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('scanBtn').addEventListener('click', startScan);
  document.getElementById('searchBox').addEventListener('input', renderList);

  document.getElementById('selectAllBtn').addEventListener('click', () => {
    document.querySelectorAll('#resultsList .entrySelect').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change')); });
  });
  document.getElementById('clearSelectionBtn').addEventListener('click', () => {
    selectedKeys.clear();
    document.querySelectorAll('#resultsList .entrySelect').forEach((cb) => { cb.checked = false; });
    updateBulkBar();
  });
  document.getElementById('copySelectedBtn').addEventListener('click', () => {
    const fw = currentFramework(); const lang = currentLanguage();
    const text = selectedEntries().map((e) => `// ${e.label || e.category}\n${WESGSnippets.generate(fw, lang, e)}`).join('\n\n');
    navigator.clipboard.writeText(text);
  });
  document.getElementById('exportPageObjectBtn').addEventListener('click', () => {
    const fw = currentFramework(); const lang = currentLanguage();
    const entries = selectedKeys.size ? selectedEntries() : allEntries;
    if (!entries.length) { showError('No elements to export — scan the page or select some rows first.'); return; }
    const className = 'ScannedPage';
    const code = WESGSnippets.generatePageObject(fw, lang, entries, className);
    const ext = { python: 'py', java: 'java', csharp: 'cs', javascript: 'js' }[lang] || 'txt';
    downloadBlob(code, 'text/plain', `${className}.${fw}.${ext}`);
  });

  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    downloadBlob(JSON.stringify(allEntries, null, 2), 'application/json', 'page-scan.json');
  });
  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const cols = ['frameId', 'category', 'label', 'cssRelative', 'xpathRelative', 'roleSel', 'recommended'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [cols.join(',')].concat(allEntries.map((e) => cols.map((c) => esc(e[c])).join(',')));
    downloadBlob(rows.join('\n'), 'text/csv', 'page-scan.csv');
  });
  document.getElementById('clearScanBtn').addEventListener('click', () => {
    sendMessageSafe({ action: 'clearScanResults', tabId: currentTabId }, () => {
      allEntries = [];
      selectedKeys.clear();
      renderList();
      setScanStatus('');
      document.getElementById('truncatedNote').style.display = 'none';
    });
  });

  document.querySelectorAll('#filtersPanel input').forEach((el) => {
    el.addEventListener('change', saveScanDefaults);
  });

  function loadForTab(tabId) {
    currentTabId = tabId;
    allEntries = [];
    selectedKeys.clear();
    setScanStatus('');
    document.getElementById('truncatedNote').style.display = 'none';
    renderList();
    loadCachedScan(tabId);
  }

  chrome.storage.sync.get(['wesg_scan_categories', 'wesg_scan_max', 'wesg_default_framework', 'wesg_default_language'], (res) => {
    if (res.wesg_scan_categories) {
      Object.keys(res.wesg_scan_categories).forEach((cat) => {
        const cb = document.querySelector(`#filtersPanel input[data-cat="${cat}"]`);
        if (cb) cb.checked = !!res.wesg_scan_categories[cat];
      });
    }
    if (res.wesg_scan_max) document.getElementById('maxElements').value = res.wesg_scan_max;
    populateFrameworkSelect(res.wesg_default_framework, res.wesg_default_language);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs && tabs[0] && tabs[0].id;
      if (tabId) loadForTab(tabId);
    });
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => loadForTab(tabId));
});
