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
  onFinish?: (summary: string, completedItems: string[]) => void;
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
        description: 'Перейти по указанному веб-адресу (URL) в браузере.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'Полный URL страницы (например, https://lavka.yandex.ru)' }
          },
          required: ['url']
        }
      },
      {
        name: 'take_screenshot',
        description: 'Сделать снимок экрана текущего состояния страницы для валидации.',
        parameters: {
          type: 'OBJECT',
          properties: {
            full_page: { type: 'BOOLEAN', description: 'Сделать скриншот всей длинной страницы целиком или только видимой области' }
          }
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
        name: 'query_dom',
        description: 'Запустить DOM Sub-Agent для поиска элементов на странице, проверки селекторов, чтения текстов и счетчиков.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Естественный вопрос к DOM (например: "Есть ли на странице поле поиска? Какой у него селектор?")' }
          },
          required: ['query']
        }
      },
      {
        name: 'click_element',
        description: 'Кликнуть на интерактивный элемент по CSS/XPath селектору.',
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
        name: 'finish_task',
        description: 'Завершить выполнение задачи и предоставить пользователю финальный структурированный отчет.',
        parameters: {
          type: 'OBJECT',
          properties: {
            summary: { type: 'STRING', description: 'Общий итог решения задачи' },
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
Твоя цель: выполнить сложную многошаговую задачу пользователя в реальном браузере.

ПРАВИЛА И АНТИПАТТЕРНЫ:
1. Запрещены преднаписанные селекторы в коде! Используй инструмент query_dom для обнаружения элементов на новой странице.
2. Эффективность действий: если query_dom уже вернул нужные селекторы (например, поле ввода и кнопку отправки поиска), СРАЗУ выполняй действия (type_text, click_element). НЕ вызывай query_dom повторно для элементов, селекторы которых уже известны.
3. Соблюдай требования безопасности (Security Layer): если пользователь просил "не оплачивай", не нажимай на финальные кнопки оплаты.
4. Действуй последовательно: Переход -> Запрос к DOM -> Действие (клик / ввод текста) -> Проверка результата / Завершение.
5. Когда цель достигнута, обязательно вызови инструмент finish_task с кратким отчетом.`;

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
        // Model provided a text thought and no tool call; if it already completed or needs a push, check
        if (response.text?.toLowerCase().includes('готово') || response.text?.toLowerCase().includes('выполнено')) {
          break;
        }
        // prompt next step
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
            toolResult = `Successfully navigated to ${res.url}`;
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
          case 'finish_task': {
            toolResult = 'Task completed successfully.';
            this.callbacks.onFinish?.(args.summary, args.completed_items || []);
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

      // Maintain lean history (prune old DOM query raw text into short summaries to protect Free Tier context)
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
