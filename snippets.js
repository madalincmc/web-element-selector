// Code-snippet generators for the most common test-automation stacks.
// Classic script (no bundler/module system) — exposes window.WESGSnippets.
// Consumed by popup.js (single element) and sidepanel.js (single + bulk export).
(function (global) {
  const FRAMEWORKS = [
    { id: 'playwright', label: 'Playwright', languages: [
      { id: 'javascript', label: 'JavaScript/TypeScript' },
      { id: 'python', label: 'Python' },
      { id: 'java', label: 'Java' },
      { id: 'csharp', label: 'C#' }
    ] },
    { id: 'selenium', label: 'Selenium WebDriver', languages: [
      { id: 'java', label: 'Java' },
      { id: 'python', label: 'Python' },
      { id: 'csharp', label: 'C#' },
      { id: 'javascript', label: 'JavaScript (Node)' }
    ] },
    { id: 'cypress', label: 'Cypress', languages: [
      { id: 'javascript', label: 'JavaScript/TypeScript' }
    ] },
    { id: 'webdriverio', label: 'WebdriverIO', languages: [
      { id: 'javascript', label: 'JavaScript/TypeScript' }
    ] }
  ];

  // ---- string escaping helpers (per target-language string literal) -------
  function escSingle(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function escDouble(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
  // Splits on non-alnum delimiters AND existing camelCase/PascalCase boundaries,
  // so "ScannedPage" and "scanned-page" both tokenize to ["Scanned", "Page"].
  function words(s) {
    return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^a-zA-Z0-9]+/).filter(Boolean);
  }
  function pascalCase(s) {
    const w = words(s);
    return w.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join('') || 'Element';
  }
  function camelCase(s) {
    const p = pascalCase(s);
    return p[0].toLowerCase() + p.slice(1);
  }
  function snakeCase(s) {
    const w = words(s);
    return w.map((word) => word.toLowerCase()).join('_') || 'element';
  }

  // ---- pick which locator to use ------------------------------------------
  // `recommended` (set by content.js) already names the best of the 8
  // generated string fields; css-like fields work with By.cssSelector/cy.get/
  // $()/page.locator(), xpath-like fields work with By.xpath/$()/page.locator().
  function pickSelector(payload) {
    const rec = payload.recommended;
    const type = rec && rec.indexOf('xpath') === 0 ? 'xpath' : 'css';
    const value = (rec && payload[rec]) || payload.cssRelative || payload.xpathRelative || '';
    return { type, value };
  }

  // Semantic locator a human would actually write by hand, when the element
  // carries a strong signal for it (test id / accessible role / short text).
  function pickSemantic(locator) {
    if (locator && locator.testId && locator.testId.value) return 'testId';
    if (locator && locator.role && locator.role.role) return 'role';
    if (locator && locator.text && /^(a|button)$/.test(locator.tag) && locator.text.length <= 40) return 'text';
    return null;
  }

  // ---- Playwright -----------------------------------------------------------
  function playwright(language, payload) {
    const locator = payload.locator || {};
    const semantic = pickSemantic(locator);
    const sel = pickSelector(payload);

    if (language === 'python') {
      if (semantic === 'testId') return `page.get_by_test_id("${escDouble(locator.testId.value)}")`;
      if (semantic === 'role') return locator.role.name
        ? `page.get_by_role("${locator.role.role}", name="${escDouble(locator.role.name)}")`
        : `page.get_by_role("${locator.role.role}")`;
      if (semantic === 'text') return `page.get_by_text("${escDouble(locator.text)}")`;
      return `page.locator("${escDouble(sel.value)}")`;
    }
    if (language === 'java') {
      if (semantic === 'testId') return `page.getByTestId("${escDouble(locator.testId.value)}")`;
      if (semantic === 'role') return locator.role.name
        ? `page.getByRole(AriaRole.${locator.role.role.toUpperCase()}, new Page.GetByRoleOptions().setName("${escDouble(locator.role.name)}"))`
        : `page.getByRole(AriaRole.${locator.role.role.toUpperCase()})`;
      if (semantic === 'text') return `page.getByText("${escDouble(locator.text)}")`;
      return `page.locator("${escDouble(sel.value)}")`;
    }
    if (language === 'csharp') {
      if (semantic === 'testId') return `page.GetByTestId("${escDouble(locator.testId.value)}")`;
      if (semantic === 'role') return locator.role.name
        ? `page.GetByRole(AriaRole.${pascalCase(locator.role.role)}, new() { Name = "${escDouble(locator.role.name)}" })`
        : `page.GetByRole(AriaRole.${pascalCase(locator.role.role)})`;
      if (semantic === 'text') return `page.GetByText("${escDouble(locator.text)}")`;
      return `page.Locator("${escDouble(sel.value)}")`;
    }
    // javascript/typescript
    if (semantic === 'testId') return `page.getByTestId('${escSingle(locator.testId.value)}')`;
    if (semantic === 'role') return locator.role.name
      ? `page.getByRole('${locator.role.role}', { name: '${escSingle(locator.role.name)}' })`
      : `page.getByRole('${locator.role.role}')`;
    if (semantic === 'text') return `page.getByText('${escSingle(locator.text)}')`;
    return `page.locator('${escSingle(sel.value)}')`;
  }

  // ---- Selenium ---------------------------------------------------------
  function seleniumBy(language, sel) {
    const isXpath = sel.type === 'xpath';
    if (language === 'python') return isXpath ? `By.XPATH, "${escDouble(sel.value)}"` : `By.CSS_SELECTOR, "${escDouble(sel.value)}"`;
    if (language === 'csharp') return isXpath ? `By.XPath("${escDouble(sel.value)}")` : `By.CssSelector("${escDouble(sel.value)}")`;
    if (language === 'javascript') return isXpath ? `By.xpath('${escSingle(sel.value)}')` : `By.css('${escSingle(sel.value)}')`;
    return isXpath ? `By.xpath("${escDouble(sel.value)}")` : `By.cssSelector("${escDouble(sel.value)}")`; // java
  }

  function selenium(language, payload) {
    const sel = pickSelector(payload);
    const by = seleniumBy(language, sel);
    if (language === 'python') return `driver.find_element(${by})`;
    if (language === 'csharp') return `driver.FindElement(${by})`;
    if (language === 'javascript') return `await driver.findElement(${by})`;
    return `driver.findElement(${by})`; // java
  }

  // ---- Cypress (CSS only — no native XPath without a plugin) ------------
  function cypress(payload) {
    const locator = payload.locator || {};
    const semantic = pickSemantic(locator);
    if (semantic === 'testId') return `cy.get('[${locator.testId.attr}="${escSingle(locator.testId.value)}"]')`;
    if (semantic === 'text') return `cy.contains('${locator.tag}', '${escSingle(locator.text)}')`;
    const sel = pickSelector(payload);
    if (sel.type === 'xpath') {
      // cy.xpath() requires the community `cypress-xpath` plugin.
      return `cy.xpath('${escSingle(sel.value)}') /* requires cypress-xpath plugin */`;
    }
    return `cy.get('${escSingle(sel.value)}')`;
  }

  // ---- WebdriverIO ($ accepts both CSS and XPath strings natively) ------
  function webdriverio(payload) {
    const locator = payload.locator || {};
    const semantic = pickSemantic(locator);
    if (semantic === 'testId') return `$('[${locator.testId.attr}="${escSingle(locator.testId.value)}"]')`;
    const sel = pickSelector(payload);
    return `$('${escSingle(sel.value)}')`;
  }

  // Returns the bare expression (no statement terminator) so it can be
  // embedded either in a one-line snippet or inside a page-object field.
  function expression(framework, language, payload) {
    if (framework === 'playwright') return playwright(language, payload);
    if (framework === 'selenium') return selenium(language, payload);
    if (framework === 'cypress') return cypress(payload);
    if (framework === 'webdriverio') return webdriverio(payload);
    return '';
  }

  // Ready-to-paste single line, including a variable assignment + terminator.
  function generate(framework, language, payload) {
    const expr = expression(framework, language, payload);
    if (!expr) return '';
    if (language === 'python') return `element = ${expr}`;
    if (language === 'java' || language === 'csharp') return `var element = ${expr};`;
    return `const element = ${expr};`; // javascript (also cypress/webdriverio, always javascript)
  }

  // ---- Bulk "page object" class skeleton ---------------------------------
  function fieldBaseName(entry) {
    const locator = entry.locator || {};
    return (locator.testId && locator.testId.value) || locator.name || locator.id ||
      (entry.label && entry.label.length <= 30 ? entry.label : null) || entry.category || locator.tag || 'element';
  }

  function uniqueNames(entries, caseFn) {
    const used = new Map();
    return entries.map((entry) => {
      let base = caseFn(fieldBaseName(entry));
      if (!base) base = 'element';
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      return count ? `${base}${count + 1}` : base;
    });
  }

  // expression() strings start with a bare `page.`/`driver.` (or, for
  // Selenium JS, `await driver.`) — inside a page-object method that
  // identifier must resolve to the instance's field, which Python and
  // JavaScript (unlike Java/C#) require spelling out explicitly.
  function qualify(expr, qualifier) { return expr.replace(/\b(page|driver)\./, `${qualifier}$1.`); }

  function generatePageObject(framework, language, entries, className) {
    const cls = pascalCase(className || 'PageObject');
    const nameFn = language === 'python' ? snakeCase : camelCase;
    const names = uniqueNames(entries, nameFn);
    const fields = entries.map((entry, i) => ({ name: names[i], expr: expression(framework, language, entry) })).filter((f) => f.expr);

    if (language === 'python') {
      const ctorArg = framework === 'playwright' ? 'page' : 'driver';
      const body = fields.map((f) => framework === 'selenium'
        ? `    def ${f.name}(self):\n        return ${qualify(f.expr, 'self.')}`
        : `    @property\n    def ${f.name}(self):\n        return ${qualify(f.expr, 'self.')}`
      ).join('\n\n');
      return `class ${cls}:\n    def __init__(self, ${ctorArg}):\n        self.${ctorArg} = ${ctorArg}\n\n${body}\n`;
    }

    if (language === 'java') {
      // Unqualified `page`/`driver` inside these methods resolve to the
      // instance field below via Java's normal simple-name lookup.
      const ctorArg = framework === 'playwright' ? 'Page page' : 'WebDriver driver';
      const field = framework === 'playwright' ? 'page' : 'driver';
      const returnType = framework === 'playwright' ? 'Locator' : 'WebElement';
      const body = fields.map((f) => `    public ${returnType} ${f.name}() {\n        return ${f.expr};\n    }`).join('\n\n');
      return `public class ${cls} {\n    private final ${ctorArg.split(' ')[0]} ${field};\n\n    public ${cls}(${ctorArg}) {\n        this.${field} = ${field};\n    }\n\n${body}\n}\n`;
    }

    if (language === 'csharp') {
      // Same implicit simple-name resolution as Java applies in C#, as long
      // as the field is named exactly `page`/`driver` to match expression().
      const ctorArg = framework === 'playwright' ? 'IPage page' : 'IWebDriver driver';
      const field = framework === 'playwright' ? 'page' : 'driver';
      const returnType = framework === 'playwright' ? 'ILocator' : 'IWebElement';
      const body = fields.map((f) => `    public ${returnType} ${pascalCase(f.name)}() => ${f.expr};`).join('\n');
      return `public class ${cls} {\n    private readonly ${ctorArg.split(' ')[0]} ${field};\n\n    public ${cls}(${ctorArg}) {\n        this.${field} = ${field};\n    }\n\n${body}\n}\n`;
    }

    // javascript/typescript
    if (framework === 'cypress' || framework === 'webdriverio') {
      // cy/$ are ambient test globals, not instance fields — no qualification needed.
      const body = fields.map((f) => `  get ${f.name}() {\n    return ${f.expr};\n  }`).join('\n\n');
      return `class ${cls} {\n${body}\n}\n\nexport default new ${cls}();\n`;
    }
    const ctorArg = framework === 'playwright' ? 'page' : 'driver';
    const body = fields.map((f) => `  get ${f.name}() {\n    return ${qualify(f.expr, 'this.')};\n  }`).join('\n\n');
    return `class ${cls} {\n  constructor(${ctorArg}) {\n    this.${ctorArg} = ${ctorArg};\n  }\n\n${body}\n}\n\nmodule.exports = { ${cls} };\n`;
  }

  global.WESGSnippets = { FRAMEWORKS, generate, generatePageObject };
})(typeof window !== 'undefined' ? window : this);
