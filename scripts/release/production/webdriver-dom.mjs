// Thin native WebDriver DOM adapter: queries return real elements; clicks/typing use WebDriver.
export function productionDomPage(driver) {
  const selector = (css, role, name, exact) => ({
    css,
    role,
    name: name instanceof RegExp ? name.source : name,
    flags: name instanceof RegExp ? name.flags : null,
    exact: !!exact,
  });
  const visibleElement = async (query) => {
    const ref = await driver.execute((q) => {
      function find(q) {
        const scopes = q.parent
          ? find(q.parent)
          : q.css
            ? Array.from(document.querySelectorAll(q.css))
            : [document];
        const candidates = scopes.flatMap((scope) =>
          q.role
            ? Array.from(
                scope.querySelectorAll(
                  `[role="${q.role}"],${q.role === 'button' ? 'button' : q.role === 'radio' ? 'input[type="radio"]' : q.role === 'spinbutton' ? 'input[type="number"]' : '[data-private-query-no-match]'}`,
                ),
              )
            : [scope],
        );
        const matches = [...new Set(candidates)].filter((el) => {
          if (el === document) return true;
          const box = el.getBoundingClientRect(),
            cs = getComputedStyle(el);
          if (!box.width || !box.height || cs.visibility === 'hidden' || cs.display === 'none')
            return false;
          const named = (
            el.getAttribute('aria-label') ||
            (el.getAttribute('aria-labelledby') || '')
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent || '')
              .join(' ')
              .trim() ||
            Array.from(el.labels || [])
              .map((label) => label.textContent)
              .join(' ')
              .trim() ||
            el.innerText ||
            el.textContent ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          return (
            q.name == null ||
            (q.flags !== null
              ? new RegExp(q.name, q.flags).test(named)
              : q.exact
                ? named === q.name
                : named.includes(q.name))
          );
        });
        if (matches.length !== 1)
          throw new Error(
            `Expected one visible ${q.role || q.css} matching ${q.name}; got ${matches.length}`,
          );
        return matches;
      }
      const element = find(q)[0];
      return q.role === 'radio' && element.labels?.length ? element.labels[0] : element;
    }, query);
    return driver.$(ref);
  };
  const locator = (query) => ({
    click: async () => (await visibleElement(query)).click(),
    isVisible: async () =>
      visibleElement(query).then(
        (e) => e.isDisplayed(),
        () => false,
      ),
    inputValue: async () => (await visibleElement(query)).getValue(),
    fill: async (value) => (await visibleElement(query)).setValue(value),
    press: async (key) => {
      await (await visibleElement(query)).click();
      await driver.keys(key);
    },
    text: async () => (await visibleElement(query)).getText(),
    getByRole: (role, options) =>
      locator({ ...selector(null, role, options.name, options.exact), parent: query }),
  });
  return {
    locator: (css) => locator(selector(css)),
    getByRole: (role, options = {}) => locator(selector(null, role, options.name, options.exact)),
    evaluate: (fn, arg) => driver.execute(fn, arg),
    screenshot: ({ path }) => driver.saveScreenshot(path),
  };
}
