const DEFAULT_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'name', 'aria-label'];
const listEl = document.getElementById('attrList');
let attrs = DEFAULT_ATTRS.slice();
let dragIndex = null;

function render() {
  listEl.innerHTML = '';
  attrs.forEach((a, i) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = String(i);
    const handle = document.createElement('span');
    handle.className = 'handle';
    handle.textContent = '≡';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = a;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'removeBtn';
    removeBtn.textContent = '✕';
    removeBtn.dataset.i = String(i);
    li.appendChild(handle);
    li.appendChild(name);
    li.appendChild(removeBtn);
    listEl.appendChild(li);
  });
}

listEl.addEventListener('click', (e) => {
  if (e.target.classList.contains('removeBtn')) {
    const i = Number(e.target.dataset.i);
    attrs.splice(i, 1);
    render();
  }
});

listEl.addEventListener('dragstart', (e) => {
  const li = e.target.closest('li');
  if (li) dragIndex = Number(li.dataset.index);
});
listEl.addEventListener('dragover', (e) => e.preventDefault());
listEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const target = e.target.closest('li');
  if (!target || dragIndex === null) return;
  const dropIndex = Number(target.dataset.index);
  const [moved] = attrs.splice(dragIndex, 1);
  attrs.splice(dropIndex, 0, moved);
  dragIndex = null;
  render();
});

document.getElementById('addAttrBtn').addEventListener('click', () => {
  const input = document.getElementById('newAttr');
  const v = input.value.trim();
  if (v && !attrs.includes(v)) {
    attrs.push(v);
    input.value = '';
    render();
  }
});

document.getElementById('resetAttrBtn').addEventListener('click', () => {
  attrs = DEFAULT_ATTRS.slice();
  render();
});

document.getElementById('saveAttrBtn').addEventListener('click', () => {
  chrome.storage.sync.set({ wesg_priority_attrs: attrs }, () => {
    const status = document.getElementById('saveStatus');
    status.textContent = 'Saved';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});

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

function collectAllHistory(cb) {
  chrome.storage.local.get(null, (all) => {
    const entries = [];
    Object.keys(all).forEach((k) => {
      if (k.startsWith('wesg_hist_') && Array.isArray(all[k])) {
        const tabId = k.slice('wesg_hist_'.length);
        all[k].forEach((e) => entries.push(Object.assign({ tabId }, e)));
      }
    });
    cb(entries);
  });
}

document.getElementById('exportJsonBtn').addEventListener('click', () => {
  collectAllHistory((entries) => {
    downloadBlob(JSON.stringify(entries, null, 2), 'application/json', 'web-element-selector-history.json');
  });
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  collectAllHistory((entries) => {
    const cols = ['tabId', 'timestamp', 'frameId', 'frameUrl', 'cssRelative', 'cssAbsolute', 'xpathRelative', 'xpathAbsolute', 'cssContains', 'xpathText', 'roleSel', 'recommended'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [cols.join(',')].concat(entries.map((e) => cols.map((c) => esc(e[c])).join(',')));
    downloadBlob(rows.join('\n'), 'text/csv', 'web-element-selector-history.csv');
  });
});

chrome.storage.sync.get('wesg_priority_attrs', (res) => {
  if (res && Array.isArray(res.wesg_priority_attrs) && res.wesg_priority_attrs.length) {
    attrs = res.wesg_priority_attrs.slice();
  }
  render();
});
