import { Page } from 'playwright';

export interface InteractiveElementInfo {
  index: number;
  tagName: string;
  type?: string;
  role?: string;
  text: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  selector: string;
  isInViewport: boolean;
}

export async function extractInteractiveElements(page: Page): Promise<{
  url: string;
  title: string;
  elements: InteractiveElementInfo[];
  summaryText: string;
}> {
  const url = page.url();
  const title = await page.title();

  const elements: InteractiveElementInfo[] = await page.evaluate(`(() => {
    function isVisible(el) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    }

    function generateSelector(el) {
      if (el.id) {
        if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(el.id)) {
          return '#' + el.id;
        }
        return '[id="' + el.id.replace(/"/g, '\\\\"') + '"]';
      }

      if (el.tagName.toLowerCase() === 'input') {
        const input = el;
        if (input.name) return 'input[name="' + input.name + '"]';
        if (input.type && input.type !== 'text') return 'input[type="' + input.type + '"]';
        if (input.placeholder) return 'input[placeholder="' + input.placeholder.slice(0, 30) + '"]';
      }

      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim().length > 0) {
        return el.tagName.toLowerCase() + '[aria-label="' + ariaLabel.replace(/"/g, '\\\\"') + '"]';
      }

      if (el.className && typeof el.className === 'string') {
        const classes = el.className
          .split(/\\s+/)
          .filter(c => c && !c.includes(':') && !c.includes('/') && c.length < 40 && !c.startsWith('hover:'));
        if (classes.length > 0) {
          const classSelector = el.tagName.toLowerCase() + '.' + classes.slice(0, 2).join('.');
          try {
            if (document.querySelectorAll(classSelector).length === 1) {
              return classSelector;
            }
          } catch (e) {}
        }
      }

      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(el) + 1;
          const parentSelector = parent.id ? '#' + parent.id : parent.tagName.toLowerCase();
          return parentSelector + ' > ' + el.tagName.toLowerCase() + ':nth-of-type(' + index + ')';
        }
      }

      return el.tagName.toLowerCase();
    }

    const results = [];
    const interactiveSelectors = [
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="searchbox"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[tabindex="0"]',
      '[data-clickable="true"]'
    ].join(', ');

    const nodes = document.querySelectorAll(interactiveSelectors);
    let indexCounter = 1;

    nodes.forEach(node => {
      if (!isVisible(node)) return;

      const rect = node.getBoundingClientRect();
      const inView = rect.top >= 0 && rect.top <= window.innerHeight && rect.left >= 0 && rect.left <= window.innerWidth;

      const tag = node.tagName.toLowerCase();
      const text = (node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100);
      const input = node;
      const placeholder = input.placeholder || undefined;
      const value = input.value || undefined;
      const ariaLabel = node.getAttribute('aria-label') || undefined;
      const role = node.getAttribute('role') || undefined;
      const type = input.type || undefined;

      const selector = generateSelector(node);

      results.push({
        index: indexCounter++,
        tagName: tag,
        type,
        role,
        text,
        value,
        placeholder,
        ariaLabel,
        selector,
        isInViewport: inView
      });
    });

    return results.slice(0, 80);
  })()`);

  const summaryLines: string[] = [
    `Page Title: "${title}"`,
    `Current URL: ${url}`,
    `Interactive Elements (${elements.length} found):`
  ];

  elements.forEach(el => {
    let details = `[${el.index}] <${el.tagName}`;
    if (el.type) details += ` type="${el.type}"`;
    if (el.role) details += ` role="${el.role}"`;
    details += `>`;
    if (el.text) details += ` "${el.text}"`;
    if (el.value) details += ` value="${el.value}"`;
    if (el.placeholder) details += ` placeholder="${el.placeholder}"`;
    if (el.ariaLabel) details += ` aria="${el.ariaLabel}"`;
    details += ` => selector: \`${el.selector}\``;
    if (el.isInViewport) details += ` (in view)`;
    summaryLines.push(details);
  });

  return {
    url,
    title,
    elements,
    summaryText: summaryLines.join('\n')
  };
}
