import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { extractInteractiveElements } from './dom-extractor.js';

export class BrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private headless: boolean;
  private screenshotsDir: string;

  constructor(headlessOverride?: boolean) {
    this.headless = headlessOverride !== undefined ? headlessOverride : config.headless;
    this.screenshotsDir = path.resolve('./screenshots');
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  async init(): Promise<void> {
    if (this.context && this.page) return;

    if (!fs.existsSync(config.userDataDir)) {
      fs.mkdirSync(config.userDataDir, { recursive: true });
    }

    this.context = await chromium.launchPersistentContext(config.userDataDir, {
      headless: this.headless,
      viewport: config.viewport,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
        '--start-maximized'
      ]
    });

    await this.context.addInitScript('window.__name = (t) => t;');

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    await this.page.addInitScript('window.__name = (t) => t;');
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error('Browser is not initialized. Call init() first.');
    }
    return this.page;
  }

  async navigate(url: string): Promise<{ success: boolean; url: string; title: string }> {
    const page = this.getPage();
    let targetUrl = url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('file://')) {
      targetUrl = `https://${targetUrl}`;
    }

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(1500);

    return {
      success: true,
      url: page.url(),
      title: await page.title()
    };
  }

  async takeScreenshot(fullPage: boolean = false): Promise<string> {
    const page = this.getPage();
    const filename = `screenshot-${Date.now()}.png`;
    const filePath = path.join(this.screenshotsDir, filename);

    await page.screenshot({
      path: filePath,
      fullPage
    });

    return filename;
  }

  async wait(seconds: number): Promise<void> {
    const page = this.getPage();
    const duration = Math.min(Math.max(seconds, 0.5), 30) * 1000;
    await page.waitForTimeout(duration);
  }

  async click(selector: string): Promise<{ success: boolean; message: string }> {
    const page = this.getPage();

    try {
      await page.waitForSelector(selector, { state: 'visible', timeout: 8000 });
      await page.click(selector, { timeout: 8000 });
      await page.waitForTimeout(1000);
      return { success: true, message: `Clicked element: ${selector}` };
    } catch (primaryErr: any) {
      // Fallback 1: evaluate scroll & dispatch click event
      try {
        const clicked = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            (el as HTMLElement).click();
            return true;
          }
          return false;
        }, selector);

        if (clicked) {
          await page.waitForTimeout(1000);
          return { success: true, message: `Clicked element via JS event: ${selector}` };
        }
      } catch (fallbackErr) {
        // Fallback failed
      }

      throw new Error(`Failed to click "${selector}": ${primaryErr.message}`);
    }
  }

  async typeText(selector: string, text: string, pressEnter: boolean = true): Promise<{ success: boolean; message: string }> {
    const page = this.getPage();

    try {
      await page.waitForSelector(selector, { state: 'visible', timeout: 8000 });
      await page.click(selector);
      await page.fill(selector, text);
      if (pressEnter) {
        await page.press(selector, 'Enter');
      }
      await page.waitForTimeout(1500);
      return { success: true, message: `Typed text into: ${selector}` };
    } catch (err: any) {
      // Fallback via value assignment and dispatch input/change
      try {
        await page.evaluate(({ sel, val, enter }) => {
          const el = document.querySelector(sel) as HTMLInputElement;
          if (el) {
            el.focus();
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (enter) {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            }
            return true;
          }
          return false;
        }, { sel: selector, val: text, enter: pressEnter });

        await page.waitForTimeout(1500);
        return { success: true, message: `Typed text via JS dispatch: ${selector}` };
      } catch {
        throw new Error(`Failed to type into "${selector}": ${err.message}`);
      }
    }
  }

  async getDOMSummary() {
    const page = this.getPage();
    return await extractInteractiveElements(page);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }
}
