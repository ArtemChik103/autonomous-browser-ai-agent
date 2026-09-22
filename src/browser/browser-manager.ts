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
  private visualCursorEnabled: boolean = false;

  constructor(headlessOverride?: boolean, existingPage?: Page, existingContext?: BrowserContext) {
    this.headless = headlessOverride !== undefined ? headlessOverride : config.headless;
    this.page = existingPage || null;
    this.context = existingContext || null;
    this.screenshotsDir = path.resolve('./screenshots');
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  setVisualCursor(enabled: boolean = true) {
    this.visualCursorEnabled = enabled;
  }

  setPage(page: Page, context?: BrowserContext) {
    this.page = page;
    if (context) this.context = context;
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

  private async ensureVisualCursor(page: Page): Promise<void> {
    if (!this.visualCursorEnabled) return;
    try {
      await page.evaluate(() => {
        if (document.getElementById('__agent_cursor')) return;
        const cur = document.createElement('div');
        cur.id = '__agent_cursor';
        cur.style.cssText = 'position:fixed;top:0;left:0;width:32px;height:32px;pointer-events:none;z-index:2147483647;transform:translate(240px, 200px);transition:transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);';
        cur.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 4px 8px rgba(0,0,0,0.8));">
            <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.54.35-.85L6.35 2.85a.5.5 0 0 0-.85.36z" fill="#0f172a" stroke="#ffffff" stroke-width="2"/>
          </svg>
          <div id="__agent_ripple" style="position:absolute;width:44px;height:44px;border-radius:50%;border:3px solid #ef4444;top:-6px;left:-6px;opacity:0;transform:scale(0.2);transition:transform 0.35s ease-out, opacity 0.35s ease-out;pointer-events:none;"></div>
          <div id="__agent_badge" style="position:absolute;left:26px;top:14px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;font-family:sans-serif;box-shadow:0 3px 6px rgba(0,0,0,0.5);letter-spacing:0.5px;">AI AGENT</div>
        `;
        if (document.body) {
          document.body.appendChild(cur);
        } else {
          document.documentElement.appendChild(cur);
        }
      });
    } catch {}
  }

  private async animateVisualCursorToSelector(page: Page, selector: string, label: string, click: boolean = false): Promise<void> {
    if (!this.visualCursorEnabled) return;
    try {
      await this.ensureVisualCursor(page);
      const coords = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, selector);

      if (coords) {
        await page.evaluate(({ x, y, label, click }) => {
          const cur = document.getElementById('__agent_cursor');
          const badge = document.getElementById('__agent_badge');
          const ripple = document.getElementById('__agent_ripple');
          if (cur) {
            cur.style.transform = `translate(${x}px, ${y}px)`;
            if (badge) badge.textContent = label;
            if (click && ripple) {
              setTimeout(() => {
                ripple.style.opacity = '1';
                ripple.style.transform = 'scale(1.5)';
                setTimeout(() => {
                  ripple.style.opacity = '0';
                  ripple.style.transform = 'scale(0.2)';
                }, 350);
              }, 280);
            }
          }
        }, { x: coords.x, y: coords.y, label, click });
        await page.waitForTimeout(click ? 500 : 350);
      }
    } catch {}
  }

  async navigate(url: string): Promise<{ success: boolean; url: string; title: string }> {
    const page = this.getPage();
    let targetUrl = url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('file://')) {
      targetUrl = `https://${targetUrl}`;
    }

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    await page.waitForTimeout(1500);
    await this.ensureVisualCursor(page);

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

  async scroll(direction: 'down' | 'up' = 'down', amount: number = 600): Promise<{ success: boolean; message: string }> {
    const page = this.getPage();
    const scrollAmount = direction === 'down' ? amount : -amount;

    if (this.visualCursorEnabled) {
      await this.ensureVisualCursor(page);
      await page.evaluate((dir) => {
        const badge = document.getElementById('__agent_badge');
        if (badge) badge.textContent = dir === 'down' ? 'SCROLLING DOWN' : 'SCROLLING UP';
      }, direction);
    }

    await page.evaluate((y) => {
      window.scrollBy({ top: y, behavior: 'smooth' });
    }, scrollAmount);

    await page.waitForTimeout(1000);
    return { success: true, message: `Scrolled ${direction} by ${amount}px` };
  }

  async pressKey(key: string): Promise<{ success: boolean; message: string }> {
    const page = this.getPage();
    await page.keyboard.press(key);
    await page.waitForTimeout(600);
    return { success: true, message: `Pressed key: ${key}` };
  }

  async readPageContent(maxLength: number = 3500): Promise<string> {
    const page = this.getPage();

    if (this.visualCursorEnabled) {
      await this.ensureVisualCursor(page);
      await page.evaluate(() => {
        const badge = document.getElementById('__agent_badge');
        if (badge) badge.textContent = 'READING REQUIREMENTS';
      });
    }

    // Visibly scroll down so the viewer can see the sections being read (duties, requirements, stack)
    await page.evaluate(() => {
      window.scrollBy({ top: 750, behavior: 'smooth' });
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.scrollBy({ top: 750, behavior: 'smooth' });
    });
    await page.waitForTimeout(1000);

    const content = await page.evaluate((max) => {
      const title = document.title || '';
      const url = window.location.href;
      const text = (document.body ? document.body.innerText : '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .join('\n');
      return `URL: ${url}\nЗаголовок: "${title}"\n\nТекстовый контент страницы:\n${text.slice(0, max)}`;
    }, maxLength);

    return content;
  }

  async click(selector: string): Promise<{ success: boolean; message: string }> {
    const page = this.getPage();

    try {
      await page.waitForSelector(selector, { state: 'visible', timeout: 8000 });
      await this.animateVisualCursorToSelector(page, selector, 'CLICK', true);

      // Check for link and remove target="_blank" so it opens in the active recorded tab
      const linkHref = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const link = el.tagName.toLowerCase() === 'a' ? (el as HTMLAnchorElement) : el.closest('a');
        if (link) {
          if (link.getAttribute('target') === '_blank') {
            link.removeAttribute('target');
          }
          return link.href || link.getAttribute('href');
        }
        return null;
      }, selector);

      const oldUrl = page.url();
      const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);

      await page.click(selector, { timeout: 8000 });
      await navPromise;
      await page.waitForTimeout(1500);

      // If clicking a vacancy link didn't navigate, open href directly
      if (linkHref && page.url() === oldUrl) {
        await page.goto(linkHref, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }

      // Check if context has a new page (popup)
      if (this.context) {
        const pages = this.context.pages();
        if (pages.length > 1) {
          const newest = pages[pages.length - 1];
          if (newest !== page && !newest.isClosed()) {
            this.page = newest;
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.ensureVisualCursor(this.page);
          }
        }
      }

      return { success: true, message: `Clicked element: ${selector} (current URL: ${this.getPage().url()})` };
    } catch (primaryErr: any) {
      // Fallback 1: evaluate scroll & dispatch click event
      try {
        const oldUrl = page.url();
        const clicked = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            const link = el.tagName.toLowerCase() === 'a' ? (el as HTMLAnchorElement) : el.closest('a');
            if (link && link.getAttribute('target') === '_blank') {
              link.removeAttribute('target');
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            (el as HTMLElement).click();
            return link ? (link.href || link.getAttribute('href')) : 'clicked';
          }
          return null;
        }, selector);

        if (clicked) {
          await page.waitForTimeout(1500);
          if (typeof clicked === 'string' && clicked.startsWith('http') && page.url() === oldUrl) {
            await page.goto(clicked, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
            await page.waitForTimeout(1500);
          }
          return { success: true, message: `Clicked element via JS event: ${selector} (current URL: ${this.getPage().url()})` };
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
      await this.animateVisualCursorToSelector(page, selector, 'TYPING', false);
      await page.click(selector);
      await page.fill(selector, text);
      if (pressEnter) {
        await page.press(selector, 'Enter');
      }
      await page.waitForTimeout(1500);
      return { success: true, message: `Typed "${text}" into: ${selector}` };
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
        return { success: true, message: `Typed "${text}" via JS dispatch: ${selector}` };
      } catch {
        throw new Error(`Failed to type into "${selector}": ${err.message}`);
      }
    }
  }

  async getDOMSummary() {
    const page = this.getPage();
    if (this.visualCursorEnabled) {
      await this.ensureVisualCursor(page);
      await page.evaluate(() => {
        const badge = document.getElementById('__agent_badge');
        if (badge) badge.textContent = 'ANALYZING DOM';
      });
    }
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
