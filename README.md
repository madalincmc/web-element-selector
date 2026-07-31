# Web Element Selector Generator

A Chrome (Manifest V3) extension that turns any element on a page into ready-to-use CSS, XPath, ARIA, and Playwright locators — for test automation, web scraping, and debugging.

## Features

- 8 locator strategies generated per element: CSS relative/absolute, XPath relative/absolute, CSS attribute-contains, XPath text-contains, ARIA role/name selector, and Playwright locator code
- A "recommended" badge automatically highlights the most robust option
- Works inside open shadow roots and same-origin iframes
- "Validate All" checks every generated selector live against the page and reports match counts
- Per-tab selection history (last 25 picks), browsable from the popup
- Right-click context menu entry point and an `Alt+Shift+E` keyboard shortcut
- Settings page: configurable attribute priority order, plus JSON/CSV export of selection history
- Everything runs locally — no data ever leaves your browser

## How it works

The extension has four parts:

- **`content.js`** — injected into every frame of every page (`all_frames: true`). It listens for hover, click, right-click, and keyboard events, walks the DOM/shadow tree from the picked element, and builds all 8 locator strings, testing each candidate for uniqueness via `querySelectorAll`/`document.evaluate` before returning it.
- **`background.js`** — the service worker. It relays messages between content scripts and the popup, keeps a per-tab selection history in `chrome.storage.local`, tracks inspect-mode state in `chrome.storage.session` (survives service worker restarts), manages the badge/context menu/keyboard shortcut, and cleans up a tab's cached data when it closes.
- **`popup.html`/`popup.js`** — the UI you see when clicking the toolbar icon: the 8 generated fields, the recommended badge, the history panel, and the inspect-mode toggle.
- **`options.html`/`options.js`** — the settings page: reorder which attributes (`data-testid`, `data-qa`, etc.) are preferred when building selectors, and export your selection history.

## Installation

**From source (development):**
1. Clone this repo.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.

**From the Chrome Web Store:** search for "Web Element Selector Generator" (or use the store link once published).

## Usage

1. **Pick an element** — three ways to do it:
   - Toggle **Inspect mode** in the popup, then click an element on the page (this blocks the click's normal behavior, e.g. link navigation).
   - Hold **Alt** and click an element anywhere, anytime — this does *not* block normal page behavior (links still navigate, buttons still submit).
   - Right-click any element and choose **"Generate selectors for this element"** from the context menu — no need to open the popup first.
   - Or press **Alt+Shift+E** to toggle Inspect mode from the keyboard.
2. **Open the popup** (click the toolbar icon) to see all 8 generated selectors. The card with the green "★ recommended" badge is the one most likely to be both unique and stable.
3. **Copy** any individual field with its Copy button, or use **Copy All** to grab every selector at once with labels.
4. Click **Validate All** to re-check each selector against the live page and confirm it matches exactly one element.
5. Click **Refresh** if the page changed after you picked the element (e.g. a class was added dynamically) to recompute selectors for the same element.
6. Open the **History** panel to revisit earlier picks from the current tab, or clear it.
7. Click the ⚙ **settings** icon to reorder attribute priority or export your history as JSON/CSV.

## Use cases

- **Writing test automation** — generate ready-to-paste Playwright locators, or CSS/XPath selectors for Selenium, Cypress, or WebdriverIO tests, without hand-crafting them in devtools.
- **QA / manual testing** — quickly check whether an element has a stable, unique selector before handing it off to an automation engineer, using "Validate All".
- **Web scraping** — get a unique CSS or XPath path to a data element without writing your own selector logic.
- **Accessibility auditing** — the ARIA/Role selector output surfaces an element's accessible role and name, useful when reviewing a11y coverage.
- **Debugging dynamic UIs** — the shadow DOM and iframe support helps when the element you care about lives inside a web component or an embedded widget, where devtools' own "Copy selector" typically falls short.
- **Working with legacy pages that lack test IDs** — the attribute-priority and multiple fallback strategies (text-contains, attribute-contains, absolute path) mean you still get something usable even without `data-testid` hooks.

## Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab` / `scripting` | Run the "Validate All" selector check against the current tab |
| `storage` | Save selection history, inspect-mode state, and settings locally |
| `contextMenus` | Add the right-click "Generate selectors for this element" entry |
| `<all_urls>` content script match | The selector engine needs to run on whatever page you're inspecting |

No data is transmitted anywhere — history and settings are stored only in your own Chrome profile.

## Known limitations

- Closed shadow roots are not accessible from page-level scripts (a browser restriction, not something this extension can work around).
- XPath selectors are not generated for elements inside a shadow root, since XPath 1.0 doesn't reliably cross shadow boundaries — use the CSS or Playwright output instead in that case.
- Cross-origin iframes are not reachable, for the same reason devtools can't inspect into them without switching context.

## Project structure

```
manifest.json     Extension manifest (MV3)
background.js     Service worker: history, badge, context menu, shortcuts
content.js        Selector-building engine, injected into every frame
popup.html/js/css Toolbar popup UI
options.html/js/css  Settings page UI
icons/            Toolbar icons
```
