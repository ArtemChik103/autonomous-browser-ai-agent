import { GeminiClient, ToolDeclaration, ChatMessage } from '../llm/client.js';
import { BrowserManager } from '../browser/browser-manager.js';
import { DOMSubAgent } from './dom-agent.js';
import { SafetyGuard } from '../security/safety-guard.js';
import { config } from '../config.js';

export interface OrchestratorCallbacks {
  onAssistantThought?: (text: string) => void;
  onToolStart?: (name: string, input: Record<string, any>) => void;
  onToolEnd?: (name: string, result: string) => void;
  onSubAgentStart?: (query: string) => void;
  onSubAgentEnd?: (result: string) => void;
  onSecurityWarning?: (reason: string) => void;
  onFinish?: (summary: string, completedItems: string[], resultContent?: string) => void;
}

export class OrchestratorAgent {
  private browser: BrowserManager;
  private domAgent: DOMSubAgent;
  private llm: GeminiClient;
  private safetyGuard: SafetyGuard;
  private callbacks: OrchestratorCallbacks;

  constructor(browser: BrowserManager, callbacks: OrchestratorCallbacks = {}) {
    this.browser = browser;
    this.domAgent = new DOMSubAgent(browser);
    this.llm = new GeminiClient(config.geminiApiKey, config.orchestratorModel);
    this.safetyGuard = new SafetyGuard();
    this.callbacks = callbacks;
  }

  private getToolsDefinition(): ToolDeclaration[] {
    return [
      {
        name: 'navigate_to_url',
        description: 'Перейти по указанному веб-адресу (URL) в браузере. Для поиска можно переходить напрямую на поисковый URL (например, https://hh.ru/search/vacancy?text=AI-инженер) или на главную страницу.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'Полный URL страницы' }
          },
          required: ['url']
        }
      },
      {
        name: 'query_dom',
        description: 'Запустить DOM Sub-Agent для поиска элементов на странице, проверки селекторов, чтения списка вакансий, кнопок и полей.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Естественный вопрос к DOM (например: "Найди ссылку на первую вакансию AI-инженера" или "Где поле поиска?")' }
          },
          required: ['query']
        }
      },
      {
        name: 'read_page_content',
        description: 'Прочитать детальное текстовое содержимое страницы (описание вакансии, требования, стек технологий, текст статьи или письма).',
        parameters: {
          type: 'OBJECT',
          properties: {
            max_length: {
              type: 'NUMBER',
              description: 'Максимальное количество символов для чтения (по умолчанию 3500)'
            }
          }
        }
      },
      {
        name: 'scroll_page',
        description: 'Прокрутить веб-страницу вверх или вниз, чтобы увидеть больше контента, скрытые элементы или прочитать текст дальше.',
        parameters: {
          type: 'OBJECT',
          properties: {
            direction: {
              type: 'STRING',
              description: 'Направление прокрутки: "down" (вниз) или "up" (вверх)',
              enum: ['down', 'up']
            },
            amount: {
              type: 'NUMBER',
              description: 'Количество пикселей для прокрутки (по умолчанию 600)'
            }
          },
          required: ['direction']
        }
      },
      {
        name: 'click_element',
        description: 'Кликнуть на интерактивный элемент по CSS/XPath селектору, полученному из query_dom.',
        parameters: {
          type: 'OBJECT',
          properties: {
            selector: { type: 'STRING', description: 'CSS селектор элемента, найденный через query_dom' }
          },
          required: ['selector']
        }
      },
      {
        name: 'type_text',
        description: 'Ввести текст в поле ввода по указанному селектору.',
        parameters: {
          type: 'OBJECT',
          properties: {
            selector: { type: 'STRING', description: 'CSS селектор поля ввода' },
            text: { type: 'STRING', description: 'Текст для ввода' }
          },
          required: ['selector', 'text']
        }
      },
      {
        name: 'press_key',
        description: 'Нажать клавишу на клавиатуре (например, "Escape" для закрытия модального окна или "Enter" для подтверждения ввода).',
        parameters: {
          type: 'OBJECT',
          properties: {
            key: { type: 'STRING', description: 'Название клавиши ("Escape", "Enter", "Tab", "ArrowDown", "ArrowUp")' }
          },
          required: ['key']
        }
      },
      {
        name: 'wait',
        description: 'Подождать заданное количество секунд для загрузки страницы, анимации или сетевого ответа.',
        parameters: {
          type: 'OBJECT',
          properties: {
            seconds: { type: 'NUMBER', description: 'Количество секунд ожидания (например, 2)' }
          },
          required: ['seconds']
        }
      },
      {
        name: 'take_screenshot',
        description: 'Сделать снимок экрана текущего состояния страницы. Не вызывай после каждого промежуточного шага, чтобы не тратить лимит шагов.',
        parameters: {
          type: 'OBJECT',
          properties: {
            full_page: { type: 'BOOLEAN', description: 'Сделать скриншот всей длинной страницы целиком или только видимой области' }
          }
        }
      },
      {
        name: 'finish_task',
        description: 'Завершить выполнение задачи и предоставить пользователю финальный структурированный отчет. Если задача требовала составить сопроводительное письмо, отчет или извлечь информацию — обязательно передай полный текст этого материала в поле result_content!',
        parameters: {
          type: 'OBJECT',
          properties: {
            summary: { type: 'STRING', description: 'Краткий общий итог решения задачи' },
            result_content: {
              type: 'STRING',
              description: 'Полный детальный результат работы: готовый текст составленного сопроводительного письма, найденные данные, извлеченная информация или сформированный отчет.'
            },
            completed_items: {
              type: 'ARRAY',
              description: 'Список выполненных ключевых пунктов',
              items: { type: 'STRING' }
            }
          },
          required: ['summary']
        }
      }
    ];
  }

  async run(userGoal: string, maxSteps: number = 25): Promise<void> {
    await this.browser.init();
    this.safetyGuard.setUserGoal(userGoal);

    const systemPrompt = `Ты — автономный AI-агент для программного управления веб-браузером.
Твоя цель: полностью автономно и последовательно выполнить сложную многошаговую задачу пользователя в реальном браузере.

ПРАВИЛА И ПРИНЦИПЫ:
1. Полная автономность: ты самостоятельно планируешь шаги, выбираешь инструменты и принимаешь решения на каждом этапе. Не жди подсказок.
2. Поиск элементов: используй query_dom для обнаружения элементов (кнопок, ссылок, форм ввода) и точных селекторов на странице.
3. Чтение и изучение страниц: используй read_page_content и query_dom для детального анализа требований вакансий, стека технологий, условий и обязанностей. Используй scroll_page для прокрутки длинных страниц.
4. Обязательность качественного результата/письма: если задача пользователя требует составить сопроводительное письмо или отчет — ты ОБЯЗАН:
   - Внимательно изучить реальный текст вакансии и требования на открытой странице;
   - Написать персонализированное, профессиональное сопроводительное письмо от имени соискателя/инженера с обращением к компании/команде, описанием релевантного стека и практического опыта;
   - Передать ПОЛНЫЙ текст составленного письма в поле result_content инструмента finish_task! Пользователь должен увидеть готовое письмо целиком.
5. Всплывающие и модальные окна: если при переходе на сайт поверх контента появляется всплывающее окно (баннер авторизации, согласие с куки, выбор региона), перекрывающее страницу — ты ОБЯЗАН закрыть его САМ с помощью click_element по кнопке закрытия (✕ или [data-qa*="close"]) либо вызвав press_key ("Escape"). Не пытайся кликать элементы под закрывающим оверлеем!
6. Соблюдай безопасность (Security Layer): не совершай деструктивных действий (оплата, удаление без подтверждения).
7. Эффективность: не вызывай take_screenshot после каждого действия — фокусируйся на открытии целевой страницы/вакансии, чтении контента и формировании результата.
8. Завершение задачи: когда цель полностью достигнута, обязательно вызови finish_task, передав summary, result_content (полный текст письма) и completed_items.`;

    const history: ChatMessage[] = [
      {
        role: 'user',
        parts: [{ text: `Задача пользователя: "${userGoal}"` }]
      }
    ];

    const tools = this.getToolsDefinition();
    let stepCount = 0;

    while (stepCount < maxSteps) {
      stepCount++;

      const response = await this.llm.generateContent(
        history,
        tools,
        systemPrompt,
        config.orchestratorModel
      );

      if (response.text) {
        this.callbacks.onAssistantThought?.(response.text);
      }

      if (!response.functionCall) {
        if (response.text?.toLowerCase().includes('готово') || response.text?.toLowerCase().includes('выполнено')) {
          break;
        }
        history.push({
          role: 'model',
          parts: [{ text: response.text || '' }]
        });
        history.push({
          role: 'user',
          parts: [{ text: 'Продолжай выполнение задачи. Вызови следующий необходимый инструмент.' }]
        });
        continue;
      }

      const { name, args } = response.functionCall;
      this.callbacks.onToolStart?.(name, args);

      // Security check
      const secCheck = this.safetyGuard.checkAction(name, args, response.text);
      if (!secCheck.allowed) {
        this.callbacks.onSecurityWarning?.(secCheck.reason || 'Action blocked by safety policy');
        const toolResult = `[ОТКЛОНЕНО SECURITY LAYER]: ${secCheck.reason}`;
        this.callbacks.onToolEnd?.(name, toolResult);

        if (response.rawContent) {
          history.push(response.rawContent);
        } else {
          history.push({
            role: 'model',
            parts: [{ functionCall: { name, args } }]
          });
        }
        history.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name,
              response: { result: toolResult }
            }
          }]
        });
        continue;
      }

      let toolResult = '';

      try {
        switch (name) {
          case 'navigate_to_url': {
            const res = await this.browser.navigate(args.url);
            toolResult = `Successfully navigated to ${res.url} (title: "${res.title}")`;
            break;
          }
          case 'take_screenshot': {
            const filename = await this.browser.takeScreenshot(args.full_page || false);
            toolResult = `Screenshot saved as ${filename}`;
            break;
          }
          case 'wait': {
            const secs = args.seconds || 2;
            await this.browser.wait(secs);
            toolResult = `Waited for ${secs} seconds`;
            break;
          }
          case 'query_dom': {
            this.callbacks.onSubAgentStart?.(args.query);
            toolResult = await this.domAgent.processQuery(args.query);
            this.callbacks.onSubAgentEnd?.(toolResult);
            break;
          }
          case 'read_page_content': {
            const content = await this.browser.readPageContent(args.max_length || 3500);
            toolResult = content;
            break;
          }
          case 'scroll_page': {
            const dir = (args.direction as 'down' | 'up') || 'down';
            const amt = args.amount || 600;
            const res = await this.browser.scroll(dir, amt);
            toolResult = res.message;
            break;
          }
          case 'click_element': {
            const res = await this.browser.click(args.selector);
            toolResult = res.message;
            break;
          }
          case 'type_text': {
            const res = await this.browser.typeText(args.selector, args.text);
            toolResult = res.message;
            break;
          }
          case 'press_key': {
            const res = await this.browser.pressKey(args.key);
            toolResult = res.message;
            break;
          }
          case 'finish_task': {
            toolResult = 'Task completed successfully.';
            this.callbacks.onFinish?.(args.summary, args.completed_items || [], args.result_content);
            return;
          }
          default:
            toolResult = `Unknown tool: ${name}`;
        }
      } catch (err: any) {
        toolResult = `Error executing ${name}: ${err.message}`;
      }

      this.callbacks.onToolEnd?.(name, toolResult);

      if (response.rawContent) {
        history.push(response.rawContent);
      } else {
        history.push({
          role: 'model',
          parts: [{ functionCall: { name, args } }]
        });
      }

      history.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name,
            response: { result: toolResult }
          }
        }]
      });
    }
  }
}
