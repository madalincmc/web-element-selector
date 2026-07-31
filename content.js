let selectedElement = null;
let inspectMode = false;
let lastContextTarget = null;

// User-configurable via the options page; falls back to this default.
let PRIORITY_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'name', 'aria-label'];
try {
  chrome.storage.sync.get('wesg_priority_attrs', (res) => {
    if (res && Array.isArray(res.wesg_priority_attrs) && res.wesg_priority_attrs.length) {
      PRIORITY_ATTRS = res.wesg_priority_attrs;
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.wesg_priority_attrs) {
      PRIORITY_ATTRS = changes.wesg_priority_attrs.newValue || PRIORITY_ATTRS;
    }
  });
} catch (e) {}

function composedTarget(e) {
  try { return (e.composedPath && e.composedPath()[0]) || e.target; } catch (err) { return e.target; }
}

// Hover highlight (only when inspecting or holding Alt)
document.addEventListener('mouseover', (e) => {
  try {
    if (!(inspectMode || e.altKey)) return;
    const t = composedTarget(e);
    if (selectedElement && selectedElement !== t) selectedElement.style.outline = '';
    t.style.outline = '2px solid blue';
    selectedElement = t;
  } catch (err) {}
}, true);

// Clear outline on mouseout only if we applied it
document.addEventListener('mouseout', (e) => {
  try {
    const t = composedTarget(e);
    if (selectedElement && selectedElement === t) selectedElement.style.outline = '';
  } catch (err) {}
}, true);

// Track the real right-click target so the context-menu entry point can use it
document.addEventListener('contextmenu', (e) => {
  try { lastContextTarget = composedTarget(e); } catch (err) {}
}, true);

// Click to generate (blocks navigation only in inspect mode; Alt+Click does NOT block)
document.addEventListener('click', (e) => {
  try {
    const capturing = inspectMode || e.altKey;
    if (!capturing) return; // normal site behavior

    if (inspectMode) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!selectedElement) selectedElement = composedTarget(e);
    emitSelection(selectedElement);
  } catch (err) {}
}, true);

// Listen for background/popup messages
chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.action) return;

  if (message.action === 'toggleInspect') {
    inspectMode = !!message.enabled;
    if (!inspectMode && selectedElement) {
      try { selectedElement.style.outline = ''; } catch (e) {}
      selectedElement = null;
    }
    return;
  }

  if (message.action === 'requestSelectorUpdate' && selectedElement) {
    emitSelection(selectedElement);
    return;
  }

  if (message.action === 'generateFromContextTarget' && lastContextTarget) {
    selectedElement = lastContextTarget;
    emitSelection(selectedElement);
    return;
  }

  if (message.action === 'scanPage') {
    runPageScan(message.options).then((result) => {
      chrome.runtime.sendMessage(Object.assign({ action: 'scanPageResult', scanId: message.scanId }, result)).catch(() => {});
    });
    return;
  }

  if (message.action === 'highlightScanElement') {
    highlightByIndex(message.index, !!message.scroll);
    return;
  }

  if (message.action === 'clearScanHighlight') {
    clearScanHighlight();
    return;
  }
});

// Utils
function escapeCss(s) { try { return CSS && CSS.escape ? CSS.escape(s) : s; } catch (e) { return s; } }
function attr(el, name) { return el.getAttribute && el.getAttribute(name); }
function unique(sel, ctx) { try { return ctx.querySelectorAll(sel).length === 1; } catch (e) { return false; } }

// XPath 1.0 has no backslash-escape for quotes inside string literals, so a
// value containing a quote needs the other delimiter, and a value containing
// both needs concat().
function xpathLiteral(value) {
  const s = String(value);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  const parts = s.split('"');
  const pieces = [];
  parts.forEach((part, i) => {
    pieces.push(`"${part}"`);
    if (i < parts.length - 1) pieces.push(`'"'`);
  });
  return `concat(${pieces.join(', ')})`;
}

function buildCssRelative(el, ctx = document) {
  if (!el || el.nodeType !== 1) return '';
  if (el.id) { const s = '#' + escapeCss(el.id); if (unique(s, ctx)) return s; }
  const prefer = PRIORITY_ATTRS;
  for (const p of prefer) {
    const v = attr(el, p);
    if (v) {
      const s = `${el.tagName.toLowerCase()}[${p}="${String(v).replace(/(["\\])/g, '\\$1')}"]`;
      if (unique(s, ctx)) return s;
    }
  }
  const classes = (el.className || '').toString().trim().split(/\s+/).filter(Boolean);
  if (classes.length) {
    for (let i = 1; i <= Math.min(3, classes.length); i++) {
      const s = `${el.tagName.toLowerCase()}.` + classes.slice(0, i).map(escapeCss).join('.');
      if (unique(s, ctx)) return s;
    }
  }
  const path = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== ctx.documentElement) {
    let part = node.tagName.toLowerCase();
    for (const p of prefer) {
      const v = attr(node, p);
      if (v) { part += `[${p}="${String(v).replace(/(["\\])/g, '\\$1')}"]`; break; }
    }
    let idx = 1, sib = node;
    while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) idx++;
    part += `:nth-of-type(${idx})`;
    path.unshift(part);
    const joined = path.join(' > ');
    if (unique(joined, ctx)) return joined;
    node = node.parentElement;
  }
  return path.join(' > ') || el.tagName.toLowerCase();
}

function buildCssAbsolute(el, ctx = document) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    let part = node.tagName.toLowerCase();
    let idx = 1, sib = node;
    while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) idx++;
    part += `:nth-of-type(${idx})`;
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

function countXPath(xp, ctx = document) {
  try { return document.evaluate(xp, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength; }
  catch (e) { return 0; }
}

function buildXPathRelative(el, ctx = document) {
  if (!el || el.nodeType !== 1) return '';
  if (el.id) return `//*[@id=${xpathLiteral(el.id)}]`;
  const prefer = PRIORITY_ATTRS;
  for (const p of prefer) {
    const v = attr(el, p);
    if (v) {
      const xp = `//${el.tagName.toLowerCase()}[@${p}=${xpathLiteral(v)}]`;
      if (countXPath(xp, ctx) === 1) return xp;
    }
  }
  const tag = el.tagName.toLowerCase();
  const t = (el.textContent || '').trim();
  if ((tag === 'a' || tag === 'button') && t && t.length <= 30) {
    const xp = `//${tag}[normalize-space(text())=${xpathLiteral(t)}]`;
    if (countXPath(xp, ctx) === 1) return xp;
  }
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    let part = node.tagName.toLowerCase();
    for (const p of ['id', ...prefer, 'type']) {
      const v = attr(node, p);
      if (v) { part += `[@${p}=${xpathLiteral(v)}]`; break; }
    }
    let idx = 1, sib = node;
    while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) idx++;
    part += `[${idx}]`;
    parts.unshift(part);
    const candidate = '//' + parts.join('/');
    if (countXPath(candidate, ctx) === 1) return candidate;
    node = node.parentElement;
  }
  return '//' + parts.join('/');
}

function buildXPathAbsolute(el, ctx = document) {
  const parts = []; let node = el;
  while (node && node.nodeType === 1) {
    let part = node.tagName.toLowerCase();
    let idx = 1, sib = node;
    while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) idx++;
    part += `[${idx}]`; parts.unshift(part); node = node.parentElement;
  }
  return '/' + parts.join('/');
}

// Extra strategies
function buildCssContains(el, ctx = document) {
  // Use stable attribute contains if present; otherwise class contains for the first class
  const attrNames = Array.from(new Set([...PRIORITY_ATTRS, 'placeholder', 'title', 'alt']));
  for (const a of attrNames) {
    const v = attr(el, a);
    if (v && v.length >= 4) {
      const chunk = String(v).slice(0, Math.min(12, v.length)).replace(/(["\\])/g, '\\$1');
      const sel = `${el.tagName.toLowerCase()}[${a}*="${chunk}"]`;
      return sel;
    }
  }
  const classes = (el.className || '').toString().trim().split(/\s+/).filter(Boolean);
  if (classes.length) return `${el.tagName.toLowerCase()}[class*="${classes[0]}"]`;
  return '';
}

function buildXPathTextContains(el, ctx = document) {
  const t = (el.textContent || '').trim();
  if (t && t.length >= 4) {
    const chunk = t.slice(0, Math.min(24, t.length));
    return `//${el.tagName.toLowerCase()}[contains(normalize-space(.), ${xpathLiteral(chunk)})]`;
  }
  return '';
}

function buildRoleSelector(el, ctx = document) {
  const role = attr(el, 'role');
  const name = attr(el, 'aria-label') || (el.textContent || '').trim();
  if (role && name) return `[role="${role}"][aria-label="${name.replace(/(["\\])/g, '\\$1')}"]`;
  if (role) return `[role="${role}"]`;
  return '';
}

function buildPlaywrightLocators(el, ctx = document) {
  const parts = [];
  const testIdAttr = PRIORITY_ATTRS.find((a) => /test|qa|cy/i.test(a) && attr(el, a));
  const testId = testIdAttr ? attr(el, testIdAttr) : null;
  const name = attr(el, 'aria-label') || (el.textContent || '').trim();
  const tag = el.tagName.toLowerCase();
  if (testId) parts.push(`getByTestId('${testId.replace(/'/g, "\\'")}')`);
  if ((tag === 'button' || tag === 'a') && name) parts.push(`getByRole('${tag === 'a' ? 'link' : 'button'}', { name: '${name.replace(/'/g, "\\'")}' })`);
  if (name && name.length <= 40) parts.push(`getByText('${name.replace(/'/g, "\\'")}')`);
  return parts.join('\n');
}

// Shadow DOM helpers
function shadowHostChain(el) {
  const hosts = [];
  let root = el.getRootNode();
  while (root && root.host) {
    hosts.unshift(root.host);
    root = root.host.getRootNode();
  }
  return hosts;
}

function buildShadowInfo(el) {
  const hosts = shadowHostChain(el);
  if (!hosts.length) return { description: '', path: '' };
  const parts = hosts.map((h) => buildCssRelative(h, h.getRootNode()));
  parts.push(buildCssRelative(el, el.getRootNode()));
  const description = `Inside shadow root of ${parts[0]}${hosts.length > 1 ? ' (nested ' + hosts.length + ' levels)' : ''}. ` +
    `CSS above is scoped to the shadow root, not queryable directly from document.querySelectorAll. ` +
    `XPath is not supported across shadow boundaries, so those fields are left empty here. ` +
    `The Playwright locator still works as-is (Playwright pierces open shadow roots automatically).`;
  return { description, path: parts.join(' >>> ') };
}

// Recommendation heuristic: pick the field most likely to be robust and readable.
function computeRecommended(sel) {
  if (sel.cssRelative) {
    if (sel.cssRelative.startsWith('#')) return 'cssRelative';
    if (/\[[a-zA-Z-]+="/.test(sel.cssRelative) && !sel.cssRelative.includes(' > ')) return 'cssRelative';
  }
  if (sel.roleSel) return 'roleSel';
  if (sel.cssRelative && !sel.cssRelative.includes(' > ')) return 'cssRelative';
  if (sel.xpathText) return 'xpathText';
  if (sel.cssRelative) return 'cssRelative';
  return 'xpathAbsolute';
}

// Structured (non-string) description of the best identifying info for an
// element, used by the code-snippet generators (snippets.js) so they don't
// have to re-parse the CSS/XPath strings to recover a testid/role/text.
function buildLocatorInfo(el) {
  const testIdAttr = PRIORITY_ATTRS.find((a) => /test|qa|cy/i.test(a) && attr(el, a));
  const testId = testIdAttr ? { attr: testIdAttr, value: attr(el, testIdAttr) } : null;
  const role = attr(el, 'role');
  const ariaLabel = attr(el, 'aria-label');
  const text = (el.textContent || '').trim();
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: attr(el, 'name') || null,
    testId,
    role: role ? { role, name: ariaLabel || (text.length <= 60 ? text : null) || null } : null,
    text: text ? text.slice(0, 60) : null,
    placeholder: attr(el, 'placeholder') || null
  };
}

function buildPayload(el) {
  const ctx = el.getRootNode();
  const inShadow = ctx !== document;

  const cssRelative = buildCssRelative(el, ctx);
  const cssAbsolute = buildCssAbsolute(el, ctx);
  const xpathRelative = inShadow ? '' : buildXPathRelative(el, ctx);
  const xpathAbsolute = inShadow ? '' : buildXPathAbsolute(el, ctx);
  const cssContains = buildCssContains(el, ctx);
  const xpathText = inShadow ? '' : buildXPathTextContains(el, ctx);
  const roleSel = buildRoleSelector(el, ctx);
  const pwLocators = buildPlaywrightLocators(el, ctx);
  const shadow = buildShadowInfo(el);

  const payload = {
    cssRelative, cssAbsolute, xpathRelative, xpathAbsolute,
    cssContains, xpathText, roleSel, pwLocators,
    shadowInfo: shadow.description, shadowPath: shadow.path,
    locator: buildLocatorInfo(el)
  };
  payload.recommended = computeRecommended(payload);
  return payload;
}

function emitSelection(el) {
  const payload = buildPayload(el);
  chrome.runtime.sendMessage(Object.assign({ action: 'elementSelected' }, payload)).catch(() => {});
}

// ---------------------------------------------------------------------------
// Full-page scan: finds every "interesting" element in this frame (this file
// runs once per frame via all_frames:true, so cross-origin iframes get their
// own independent scan that the background script aggregates by frameId).
// ---------------------------------------------------------------------------

const DEFAULT_SCAN_CATEGORIES = {
  testId: true, form: true, button: true, link: true, input: true,
  heading: false, landmark: false, image: false
};

function buildScanSelector(opts) {
  const cat = opts.categories || {};
  const parts = [];
  if (cat.link) parts.push('a[href]');
  if (cat.button) parts.push('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]');
  if (cat.input) parts.push('input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select');
  if (cat.form) parts.push('form');
  if (cat.heading) parts.push('h1, h2, h3, h4, h5, h6');
  if (cat.landmark) parts.push('[role]');
  if (cat.image) parts.push('img');
  if (cat.testId) PRIORITY_ATTRS.forEach((a) => parts.push(`[${a}]`));
  (opts.customSelectors || []).forEach((s) => { if (s && s.trim()) parts.push(s.trim()); });
  return parts.join(', ') || 'a[href], button';
}

// querySelectorAll doesn't pierce shadow roots, so walk every open shadow
// root under `root` and repeat the query inside it.
function collectElementsDeep(root, selector, out, seen) {
  let matched;
  try { matched = root.querySelectorAll(selector); } catch (e) { return; }
  matched.forEach((el) => { if (!seen.has(el)) { seen.add(el); out.push(el); } });
  let all;
  try { all = root.querySelectorAll('*'); } catch (e) { return; }
  all.forEach((el) => { if (el.shadowRoot) collectElementsDeep(el.shadowRoot, selector, out, seen); });
}

function categorizeElement(el) {
  const tag = el.tagName.toLowerCase();
  const role = attr(el, 'role');
  const hasTestId = PRIORITY_ATTRS.some((a) => /test|qa|cy/i.test(a) && attr(el, a));
  if (hasTestId) return 'testId';
  if (tag === 'form') return 'form';
  if (tag === 'a' && attr(el, 'href')) return 'link';
  const inputType = (attr(el, 'type') || '').toLowerCase();
  if (tag === 'button' || role === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(inputType))) return 'button';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'img') return 'image';
  if (role) return 'landmark';
  return 'other';
}

function isVisible(el) {
  try {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    return true;
  } catch (e) { return true; }
}

function labelFor(el) {
  const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
  if (t) return t.slice(0, 60);
  const v = attr(el, 'value') || attr(el, 'placeholder') || attr(el, 'aria-label') || attr(el, 'alt');
  if (v) return v.slice(0, 60);
  return `<${el.tagName.toLowerCase()}>`;
}

function idle() {
  return new Promise((resolve) => {
    if (window.requestIdleCallback) requestIdleCallback(() => resolve(), { timeout: 200 });
    else setTimeout(resolve, 0);
  });
}

// Live element refs from the most recent scan in this frame, indexed so the
// side panel can ask for a hover-highlight/scroll by index without holding
// DOM references itself (messages are structured-cloned, not live refs).
let scanElements = [];
let scanHighlightEl = null;

function highlightByIndex(i, scroll) {
  clearScanHighlight();
  const el = scanElements[i];
  if (!el) return;
  try {
    el.style.outline = '3px solid #ef4444';
    el.style.outlineOffset = '1px';
    scanHighlightEl = el;
    if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {}
}

function clearScanHighlight() {
  if (scanHighlightEl) {
    try { scanHighlightEl.style.outline = ''; scanHighlightEl.style.outlineOffset = ''; } catch (e) {}
    scanHighlightEl = null;
  }
}

const CHUNK_SIZE = 40;

async function runPageScan(options) {
  const opts = Object.assign({ categories: DEFAULT_SCAN_CATEGORIES, customSelectors: [], visibleOnly: false, maxElements: 500 }, options || {});
  const selector = buildScanSelector(opts);
  const seen = new Set();
  const candidates = [];
  collectElementsDeep(document, selector, candidates, seen);

  scanElements = [];
  const entries = [];
  let truncated = false;

  for (let i = 0; i < candidates.length; i++) {
    if (entries.length >= opts.maxElements) { truncated = true; break; }
    const el = candidates[i];
    if (opts.visibleOnly && !isVisible(el)) continue;

    const category = categorizeElement(el);
    const payload = buildPayload(el);
    const index = scanElements.length;
    scanElements.push(el);
    entries.push(Object.assign(
      { index, category, label: labelFor(el), visible: isVisible(el) },
      payload
    ));

    if (entries.length % CHUNK_SIZE === 0) await idle();
  }

  return { entries, truncated, total: candidates.length };
}
