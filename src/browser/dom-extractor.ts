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

export interface ModalWarning {
  title: string;
  closeSelector: string | null;
}

export interface ExtractedDOMData {
  elements: InteractiveElementInfo[];
  pageText: string;
  modalWarning: ModalWarning | null;
}

export async function extractInteractiveElements(page: Page): Promise<{
  url: string;
  title: string;
  elements: InteractiveElementInfo[];
  summaryText: string;
  pageTextExcerpt?: string;
  modalWarning?: ModalWarning | null;
}> {
  const url = page.url();
  const title = await page.title();

  const extractorScript = `
(() => {
  function isVisible(el) {
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    var rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  function generateSelector(el) {
    if (el.id) {
      if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(el.id)) {
        return '#' + el.id;
      }
      return '[id="' + el.id.replace(/"/g, '\\\\"') + '"]';
    }

    var dataTestId = el.getAttribute('data-testid') || el.getAttribute('data-qa');
    if (dataTestId && dataTestId.trim().length > 0) {
      var attr = el.hasAttribute('data-testid') ? 'data-testid' : 'data-qa';
      return el.tagName.toLowerCase() + '[' + attr + '="' + dataTestId.replace(/"/g, '\\\\"') + '"]';
    }

    if (el.tagName.toLowerCase() === 'input') {
      if (el.name) return 'input[name="' + el.name + '"]';
      if (el.type && el.type !== 'text') return 'input[type="' + el.type + '"]';
      if (el.placeholder) return 'input[placeholder="' + el.placeholder.slice(0, 30) + '"]';
    }

    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim().length > 0) {
      return el.tagName.toLowerCase() + '[aria-label="' + ariaLabel.replace(/"/g, '\\\\"') + '"]';
    }

    if (el.className && typeof el.className === 'string') {
      var classes = el.className
        .split(/\\s+/)
        .filter(function(c) { return c && !c.includes(':') && !c.includes('/') && c.length < 40 && !c.startsWith('hover:'); });
      if (classes.length > 0) {
        var classSelector = el.tagName.toLowerCase() + '.' + classes.slice(0, 2).join('.');
        try {
          if (document.querySelectorAll(classSelector).length === 1) {
            return classSelector;
          }
        } catch (e) {}
      }
    }

    var parent = el.parentElement;
    if (parent) {
      var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; });
      if (siblings.length > 1) {
        var index = siblings.indexOf(el) + 1;
        var parentSelector = parent.id ? '#' + parent.id : parent.tagName.toLowerCase();
        return parentSelector + ' > ' + el.tagName.toLowerCase() + ':nth-of-type(' + index + ')';
      }
    }

    return el.tagName.toLowerCase();
  }

  // Detect active modal / popup overlay
  var modalWarning = null;
  var modalEl = document.querySelector('[role="dialog"], [aria-modal="true"], [data-qa*="modal"], [class*="modal"]');
  if (modalEl && isVisible(modalEl)) {
    var closeBtn = modalEl.querySelector('button[data-qa*="close"], button[aria-label*="close" i], button[aria-label*="закрыт" i], button, [role="button"]');
    var modalTitleEl = modalEl.querySelector('h1, h2, h3, [class*="title"]');
    var modalTitleText = (modalTitleEl ? modalTitleEl.textContent : modalEl.textContent) || '';
    modalWarning = {
      title: modalTitleText.replace(/\\s+/g, ' ').trim().slice(0, 60),
      closeSelector: closeBtn ? generateSelector(closeBtn) : null
    };
  }

  var results = [];
  var interactiveSelectors = [
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

  var nodes = document.querySelectorAll(interactiveSelectors);
  var indexCounter = 1;

  nodes.forEach(function(node) {
    if (!isVisible(node)) return;

    var rect = node.getBoundingClientRect();
    var inView = rect.top >= 0 && rect.top <= window.innerHeight && rect.left >= 0 && rect.left <= window.innerWidth;

    var tag = node.tagName.toLowerCase();
    var text = (node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100);
    var placeholder = node.placeholder || undefined;
    var value = node.value || undefined;
    var ariaLabel = node.getAttribute('aria-label') || undefined;
    var role = node.getAttribute('role') || undefined;
    var type = node.type || undefined;

    var selector = generateSelector(node);

    results.push({
      index: indexCounter++,
      tagName: tag,
      type: type,
      role: role,
      text: text,
      value: value,
      placeholder: placeholder,
      ariaLabel: ariaLabel,
      selector: selector,
      isInViewport: inView
    });
  });

  var pageText = (document.body ? document.body.innerText : '')
    .split('\\n')
    .map(function(l) { return l.trim(); })
    .filter(function(l) { return l.length > 0; })
    .slice(0, 60)
    .join('\\n')
    .slice(0, 2500);

  return {
    elements: results.slice(0, 80),
    pageText: pageText,
    modalWarning: modalWarning
  };
})()
`;

  const extractedData = (await page.evaluate(extractorScript)) as ExtractedDOMData;

  const summaryLines: string[] = [
    `Page Title: "${title}"`,
    `Current URL: ${url}`
  ];

  if (extractedData.modalWarning) {
    summaryLines.push(`\n⚠️ ВНИМАНИЕ: На странице открыто всплывающее модальное окно: "${extractedData.modalWarning.title}". Оно перекрывает страницу!`);
    if (extractedData.modalWarning.closeSelector) {
      summaryLines.push(`Селектор кнопки закрытия модального окна: \`${extractedData.modalWarning.closeSelector}\`. Закрой его через click_element перед продолжением!\n`);
    }
  }

  if (extractedData.pageText && extractedData.pageText.trim()) {
    summaryLines.push(`\n=== ТЕКСТОВЫЙ КОНТЕНТ СТРАНИЦЫ (ВЫДЕРЖКА) ===`);
    summaryLines.push(extractedData.pageText);
    summaryLines.push(`=== КОНЕЦ ТЕКСТОВОГО КОНТЕНТА ===\n`);
  }

  summaryLines.push(`Interactive Elements (${extractedData.elements.length} found):`);

  extractedData.elements.forEach(el => {
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
    elements: extractedData.elements,
    summaryText: summaryLines.join('\n'),
    pageTextExcerpt: extractedData.pageText,
    modalWarning: extractedData.modalWarning
  };
}
