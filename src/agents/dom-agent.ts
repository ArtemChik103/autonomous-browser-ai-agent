import { GeminiClient } from '../llm/client.js';
import { BrowserManager } from '../browser/browser-manager.js';
import { config } from '../config.js';

export class DOMSubAgent {
  private llm: GeminiClient;
  private browser: BrowserManager;

  constructor(browser: BrowserManager, llm?: GeminiClient) {
    this.browser = browser;
    this.llm = llm || new GeminiClient(config.geminiApiKey, config.domSubagentModel);
  }

  async processQuery(query: string): Promise<string> {
    const domData = await this.browser.getDOMSummary();

    const systemPrompt = `Ты — специализированный DOM Sub-Agent в архитектуре веб-автоматизации.
Твоя задача — анализировать интерактивные элементы и текстовое содержимое веб-страницы и отвечать на поисковые и аналитические запросы Оркестратора.

ПРАВИЛА:
1. Если запрошены элементы (кнопки, инпуты, ссылки, карточки товаров) — найди их и укажи точные CSS-селекторы из списка.
2. Если запрошена информация по тексту страницы (требования вакансии, обязанности, условия, цены, факты) — извлеки факты из текстового контента и предоставь четкую выжимку.
3. Если в начале описания страницы есть предупреждение об активном модальном окне (⚠️ ВНИМАНИЕ: На странице открыто всплывающее модальное окно...) — первой строкой предупреди Оркестратора и укажи селектор кнопки закрытия (✕) или посоветуй нажать Escape!
4. Отвечай на русском языке, структурированно, профессионально и кратко, как подобает техническому агенту.`;

    const userMessage = `ТЕКУЩАЯ СТРАНИЦА:
URL: ${domData.url}
Заголовок: "${domData.title}"

ИНТЕРАКТИВНЫЕ ЭЛЕМЕНТЫ:
${domData.summaryText}

ЗАПРОС ОРКЕСТРАТОРА:
${query}

Дай точный структурированный ответ с селекторами и описанием элементов.`;

    try {
      const response = await this.llm.generateContent(
        [
          {
            role: 'user',
            parts: [{ text: userMessage }]
          }
        ],
        undefined,
        systemPrompt,
        config.domSubagentModel
      );

      return response.text || 'Элементы по запросу не найдены.';
    } catch (err: any) {
      // Fallback: local heuristic search over extracted DOM elements
      const queryLower = query.toLowerCase();
      const match = domData.elements.find(el => {
        const textMatch = el.text && queryLower.includes(el.text.toLowerCase());
        const tagMatch = (queryLower.includes('ссылк') && el.tagName === 'a') ||
                         (queryLower.includes('кнопк') && (el.tagName === 'button' || el.role === 'button')) ||
                         (queryLower.includes('поиск') && (el.tagName === 'input' || el.role === 'searchbox'));
        return textMatch || tagMatch;
      }) || domData.elements[0];

      if (match) {
        return `[DOM Sub-Agent (Auto-detected)]: Найден подходящий элемент <${match.tagName}>: "${match.text || ''}". Селектор: \`${match.selector}\``;
      }

      return `[DOM Sub-Agent]: Список интерактивных элементов:\n${domData.summaryText.slice(0, 500)}`;
    }
  }
}
