import { config } from '../config.js';

export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterProperty;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

export interface MessagePart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, any>;
    id?: string;
  };
  functionResponse?: {
    name: string;
    response: {
      result: any;
    };
  };
}

export interface ChatMessage {
  role: 'user' | 'model';
  parts: MessagePart[];
}

export interface GenerateContentResult {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, any>;
    id?: string;
  };
  rawContent?: any;
}

export class GeminiClient {
  private static keyPool: string[] = config.geminiApiKeys;
  private static keyIndex: number = 0;
  private static lastCallTime: number = 0;
  private defaultModel: string;

  constructor(apiKey?: string, model?: string) {
    if (apiKey && !GeminiClient.keyPool.includes(apiKey)) {
      GeminiClient.keyPool.unshift(apiKey);
    }
    this.defaultModel = model || config.orchestratorModel;

    if (GeminiClient.keyPool.length === 0) {
      throw new Error('GEMINI_API_KEY is not configured in .env');
    }
  }

  private static getNextApiKey(): string {
    const key = GeminiClient.keyPool[GeminiClient.keyIndex % GeminiClient.keyPool.length];
    GeminiClient.keyIndex++;
    return key;
  }

  private async enforceRateLimitPacing(): Promise<void> {
    const now = Date.now();
    const elapsed = now - GeminiClient.lastCallTime;
    if (elapsed < config.stepCooldownMs) {
      const waitTime = config.stepCooldownMs - elapsed;
      await new Promise((res) => setTimeout(res, waitTime));
    }
    GeminiClient.lastCallTime = Date.now();
  }

  async generateContent(
    contents: ChatMessage[],
    tools?: ToolDeclaration[],
    systemInstruction?: string,
    model?: string
  ): Promise<GenerateContentResult> {
    const targetModel = model || this.defaultModel;

    const requestBody: any = {
      contents,
    };

    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    if (tools && tools.length > 0) {
      requestBody.tools = [
        {
          functionDeclarations: tools,
        },
      ];
    }

    let retries = 0;
    const maxRetries = 20;
    let currentApiKey = GeminiClient.getNextApiKey();

    while (true) {
      await this.enforceRateLimitPacing();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${currentApiKey}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (response.status === 429 || response.status === 503) {
          retries++;
          if (retries > maxRetries) {
            throw new Error(`Gemini API rate limit exceeded after ${maxRetries} retries (${response.statusText})`);
          }
          const errText = await response.text().catch(() => '');
          const prevKeyMasked = currentApiKey.slice(0, 10) + '...';
          currentApiKey = GeminiClient.getNextApiKey();
          const nextKeyMasked = currentApiKey.slice(0, 10) + '...';

          if (retries % GeminiClient.keyPool.length === 0) {
            const match = errText.match(/retry in ([0-9.]+)s/i);
            const waitSec = match ? Math.ceil(parseFloat(match[1])) + 2 : 15;
            console.warn(`[Key Rotator] Все 5 ключей пула временно на паузе. Ожидание ${waitSec}с согласно Google Quota Window...`);
            await new Promise((res) => setTimeout(res, waitSec * 1000));
          } else {
            console.warn(`[Key Rotator] 429 на ключе ${prevKeyMasked}. Мгновенное переключение на ключ ${nextKeyMasked} (${retries}/${maxRetries})...`);
          }
          GeminiClient.lastCallTime = Date.now();
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API error (${response.status} ${response.statusText}): ${errText}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content?.parts) {
          return { text: '' };
        }

        const rawContent = candidate.content;
        const textPart = candidate.content.parts
          .filter((p: any) => p.text)
          .map((p: any) => p.text)
          .join('\n')
          .trim();

        for (const part of candidate.content.parts) {
          if (part.functionCall) {
            return {
              text: textPart || undefined,
              functionCall: {
                name: part.functionCall.name,
                args: part.functionCall.args || {},
                id: part.functionCall.id,
              },
              rawContent,
            };
          }
        }

        return { text: textPart, rawContent };
      } catch (err: any) {
        if (retries < maxRetries && (err.message.includes('fetch failed') || err.message.includes('network'))) {
          retries++;
          const backoff = Math.pow(2, retries) * 1000;
          await new Promise((res) => setTimeout(res, backoff));
          continue;
        }
        throw err;
      }
    }
  }
}
