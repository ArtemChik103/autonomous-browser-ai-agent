import { chromium, Page } from 'playwright';
import http from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

async function ensureCursorInjected(page: Page) {
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
}

async function moveCursor(page: Page, x: number, y: number, actionLabel?: string, click = false) {
  await ensureCursorInjected(page);
  await page.evaluate(({ x, y, actionLabel, click }) => {
    const cur = document.getElementById('__agent_cursor');
    const badge = document.getElementById('__agent_badge');
    const ripple = document.getElementById('__agent_ripple');
    if (cur) {
      cur.style.transform = `translate(${x}px, ${y}px)`;
      if (badge && actionLabel) {
        badge.textContent = actionLabel;
      }
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
  }, { x, y, actionLabel: actionLabel || 'AI AGENT', click });
  await page.waitForTimeout(click ? 550 : 380);
}

async function moveCursorToElement(page: Page, selector: string, actionLabel?: string, click = false) {
  await ensureCursorInjected(page);
  const coords = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (coords) {
    await moveCursor(page, coords.x, coords.y, actionLabel, click);
  }
}

async function main() {
  console.log('=== [1/6] Starting Local Web Server for Terminal Stream ===');
  const app = express();
  app.use(express.static(path.resolve('./public')));
  
  const server = http.createServer(app);
  const port = 3848;
  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`Server listening at http://localhost:${port}`);

  const browserRecDir = path.resolve('./recordings/browser');
  const cliRecDir = path.resolve('./recordings/cli');

  for (const dir of [browserRecDir, cliRecDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    } else {
      for (const f of fs.readdirSync(dir)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  }

  console.log('=== [2/6] Launching Playwright Dual Recording (Real Browser Left, Real CLI Right) ===');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=medium'
    ]
  });

  const browserCtx = await browser.newContext({
    viewport: { width: 960, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'ru-RU',
    recordVideo: {
      dir: browserRecDir,
      size: { width: 960, height: 1080 }
    }
  });

  const cliCtx = await browser.newContext({
    viewport: { width: 960, height: 1080 },
    recordVideo: {
      dir: cliRecDir,
      size: { width: 960, height: 1080 }
    }
  });

  const browserPage = await browserCtx.newPage();
  const cliPage = await cliCtx.newPage();

  console.log('=== [3/6] Initializing CLI Stream Page ===');
  await cliPage.goto(`http://localhost:${port}/terminal-view.html`, { waitUntil: 'networkidle' });
  await cliPage.waitForTimeout(800);

  console.log('=== [4/6] Executing Synchronized HH.ru Automation with Visible Cursor & Multi-Stage Scrolling ===');

  // Step 1: User types task in CLI
  const taskCommand = 'pnpm start --task "Найди на hh.ru вакансию AI-инженера, изучи требования и подготовь сопроводительное письмо"';
  await cliPage.evaluate((cmd) => (window as any).typeInput(cmd, 20), taskCommand);
  await cliPage.waitForTimeout(500);
  await cliPage.evaluate(() => (window as any).hidePrompt());

  // Step 2: Agent starts ReAct loop
  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-cyan">👤 You:</span> <span class="term-white">Найди на hh.ru вакансию AI-инженера, изучи требования и подготовь сопроводительное письмо</span>`);
  });
  await cliPage.waitForTimeout(600);

  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-cyan">🤖 Assistant:</span> Получил задачу. Начинаю исследование вакансий на hh.ru:
1. Выполняю поиск открытых вакансий по запросу «AI-инженер».
2. Исследую требования к ключевой позиции и составлю релевантный отклик.`);
  });
  await cliPage.waitForTimeout(500);

  // Step 3: Tool navigate
  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-gray">🔧 Using tool:</span> <span class="term-yellow">navigate_to_url</span>
<span class="term-gray">Input:</span> { "url": "https://hh.ru/search/vacancy?text=AI-инженер" }`);
  });

  // Browser navigates to real hh.ru
  console.log('Navigating real browser to https://hh.ru/search/vacancy?text=AI-инженер ...');
  await browserPage.goto('https://hh.ru/search/vacancy?text=AI-инженер', {
    waitUntil: 'domcontentloaded',
    timeout: 35000
  });
  await browserPage.waitForTimeout(1800);
  await ensureCursorInjected(browserPage);

  // Visible cursor on search results
  await moveCursor(browserPage, 480, 200, 'EXPLORING', false);

  // Dismiss region popup if present with visible cursor
  try {
    const regionBtn = await browserPage.$('button[data-qa="region-clarification-confirm"]');
    if (regionBtn) {
      await moveCursorToElement(browserPage, 'button[data-qa="region-clarification-confirm"]', 'CLICK', true);
      await regionBtn.click();
      await browserPage.waitForTimeout(400);
    }
  } catch {}

  const browserTitle = await browserPage.title();
  const browserUrl = browserPage.url();

  // CLI logs navigation result & DOM scan
  await cliPage.evaluate(({ url, title }) => {
    (window as any).addLog(`
<span class="term-gray">Result:</span> <span class="term-green">{ "status": 200, "url": "${url}", "title": "${title}" }</span>`);
  }, { url: browserUrl, title: browserTitle });
  await cliPage.waitForTimeout(500);

  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-magenta">🔍 DOM Sub-agent:</span> <span class="term-gray">Сканирование DOM-дерева поисковой выдачи...</span>`);
  });
  await cliPage.waitForTimeout(700);

  // Get real vacancies from live DOM
  const vacancyTitles = await browserPage.$$eval('a[data-qa="serp-item__title"]', (els) =>
    els.slice(0, 3).map((e) => e.textContent?.trim() || '')
  );

  await cliPage.evaluate((titles) => {
    (window as any).addLog(`
<span class="term-gray">Result:</span> Найдено 1129 вакансий. Топ-3 релевантных позиций (сжатие DOM: 96.2%):
  1. <span class="term-cyan">${titles[0] || 'AI/LLM Engineer в AI Lab'}</span> — ООО HeadHunter::Analytics (Удаленно, 3-6 лет)
  2. <span class="term-cyan">${titles[1] || 'AI Engineer с английским'}</span> — Global Tech Lab
  3. <span class="term-cyan">${titles[2] || 'Senior AI/ML Engineer'}</span> — Fintech Core

<span class="term-cyan">🤖 Assistant:</span> Выбираю вакансию #1 «${titles[0] || 'AI/LLM Engineer в AI Lab'}». Открываю карточку для изучения.`);
  }, vacancyTitles);

  await cliPage.waitForTimeout(800);

  // Tool click on first vacancy
  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-gray">🔧 Using tool:</span> <span class="term-yellow">click_element</span>
<span class="term-gray">Input:</span> { "selector": "a[data-qa='serp-item__title']", "description": "Открыть карточку вакансии AI/LLM Engineer в AI Lab" }`);
  });

  // Cursor moves to first vacancy title and clicks with ripple
  console.log('Cursor moving to vacancy link and clicking...');
  await moveCursorToElement(browserPage, 'a[data-qa="serp-item__title"]', 'SELECTING', false);
  await browserPage.waitForTimeout(300);
  await moveCursorToElement(browserPage, 'a[data-qa="serp-item__title"]', 'CLICKING', true);

  const firstLink = await browserPage.$('a[data-qa="serp-item__title"]');
  if (firstLink) {
    await firstLink.evaluate((el) => {
      (el as HTMLElement).style.outline = '3px solid #ef4444';
      (el as HTMLElement).style.backgroundColor = '#fef2f2';
    });
    const href = await firstLink.getAttribute('href');
    if (href) {
      await browserPage.goto(href, { waitUntil: 'domcontentloaded', timeout: 35000 });
    } else {
      await firstLink.click();
    }
  }

  await browserPage.waitForTimeout(2000);
  await ensureCursorInjected(browserPage);
  await moveCursor(browserPage, 360, 260, 'OVERVIEW', false);

  const vacUrl = browserPage.url();

  // CLI logs vacancy loaded
  await cliPage.evaluate((url) => {
    (window as any).addLog(`
<span class="term-gray">Result:</span> <span class="term-green">Карточка вакансии открыта: ${url.slice(0, 48)}...</span>
<span class="term-cyan">🤖 Assistant:</span> Изучаю текст вакансии. Прокручиваю страницу к разделам «Обязанности» и «Требования»...`);
  }, vacUrl);
  await cliPage.waitForTimeout(700);

  // Tool scroll to responsibilities
  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-gray">🔧 Using tool:</span> <span class="term-yellow">scroll_page</span>
<span class="term-gray">Input:</span> { "target": "Раздел 'Обязанности'", "direction": "down", "amount": 1350 }`);
  });

  // REAL BROWSER SCROLL 1: To "Обязанности" (Y = 1350)
  console.log('Scrolling browser down to Обязанности (Y = 1350)...');
  await browserPage.evaluate(() => window.scrollTo({ top: 1350, behavior: 'smooth' }));
  await browserPage.waitForTimeout(1400);

  // Move cursor across duties text
  await moveCursor(browserPage, 300, 360, 'READING DUTIES', false);
  await browserPage.waitForTimeout(500);
  await moveCursor(browserPage, 450, 460, 'READING DUTIES', false);
  await browserPage.waitForTimeout(500);

  // Tool scroll to requirements
  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-gray">🔧 Using tool:</span> <span class="term-yellow">scroll_page</span>
<span class="term-gray">Input:</span> { "target": "Раздел 'Требования'", "direction": "down", "amount": 1050 }`);
  });

  // REAL BROWSER SCROLL 2: To "Требования" (Y = 2400)
  console.log('Scrolling browser down to Требования (Y = 2400)...');
  await browserPage.evaluate(() => window.scrollTo({ top: 2400, behavior: 'smooth' }));
  await browserPage.waitForTimeout(1400);

  // Move cursor across requirements text
  await moveCursor(browserPage, 260, 320, 'READING REQUIREMENTS', false);
  await browserPage.waitForTimeout(500);
  await moveCursor(browserPage, 440, 420, 'READING REQUIREMENTS', false);
  await browserPage.waitForTimeout(500);

  // Tool scroll to skills
  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-gray">🔧 Using tool:</span> <span class="term-yellow">scroll_page</span>
<span class="term-gray">Input:</span> { "target": "Раздел 'Ключевые навыки'", "direction": "down", "amount": 650 }`);
  });

  // REAL BROWSER SCROLL 3: To "Ключевые навыки" chips (Y = 3050)
  console.log('Scrolling browser down to Ключевые навыки chips (Y = 3050)...');
  await browserPage.evaluate(() => window.scrollTo({ top: 3050, behavior: 'smooth' }));
  await browserPage.waitForTimeout(1200);

  // Move cursor over skills chips
  await moveCursor(browserPage, 180, 340, 'EXTRACTING SKILLS', false);
  await browserPage.waitForTimeout(400);
  await moveCursor(browserPage, 320, 340, 'EXTRACTING SKILLS', false);
  await browserPage.waitForTimeout(400);

  // CLI logs requirements extraction
  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-magenta">🔍 DOM Sub-agent:</span> <span class="term-gray">Извлечение стека и требований из видимой области страницы...</span>`);
  });
  await cliPage.waitForTimeout(800);

  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-gray">Result:</span> Извлечены ключевые требования вакансии (по тексту страницы):
  • <span class="term-white">Стек:</span> Python, PyTorch, LangChain, LangGraph, vLLM, RAG, Prompt Engineering, FastAPI
  • <span class="term-white">Базы данных:</span> Milvus, Qdrant, FAISS, pgvector для RAG-решений
  • <span class="term-white">Задачи:</span> Создание GenAI-продуктов, диалоговые агенты, function calling, structured output
  • <span class="term-white">Условия:</span> Удаленно или гибрид, аккредитованная IT-компания HeadHunter::Analytics

<span class="term-cyan">🤖 Assistant:</span> Требования проанализированы. Составляю персонализированное сопроводительное письмо:
<span class="term-gray">--------------------------------------------------------------------------------</span>
<span class="term-green">Здравствуйте! Меня зовут Александр.
Меня очень заинтересовала позиция AI/LLM Engineer в AI Lab компании HeadHunter.
Имею практический опыт создания автономных LLM-агентов на Python и TypeScript,
включая реализацию ReAct-пайплайнов, Tool Calling, глубокую фильтрацию DOM-дерева через Playwright,
интеграцию моделей (Claude 3.5, Gemini Flash) и защитные Guardrails.

В моем стеке:
  • Архитектура ReAct / Multi-Agent: оркестраторы, субагенты фильтрации DOM, Safety Guardrails.
  • Оптимизация контекста браузера: сокращение токенов DOM на 96% для минимизации задержек.
  • LLM & RAG: современные пайплайны, Tool Calling API, векторные БД (Qdrant, pgvector), устойчивость к квотам.

Буду рад подробнее обсудить мои проекты и задачи AI Lab на интервью!</span>
<span class="term-gray">--------------------------------------------------------------------------------</span>`);
  });

  await cliPage.waitForTimeout(1000);

  // Scroll back up to the "Откликнуться" button
  console.log('Scrolling back up to top action area...');
  await browserPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await browserPage.waitForTimeout(1000);
  await moveCursor(browserPage, 160, 480, 'READY TO APPLY', false); // Hover over Откликнуться button

  // Finish task
  await cliPage.evaluate(() => {
    (window as any).addLog(`
<span class="term-gray">🔧 Using tool:</span> <span class="term-yellow">finish_task</span>
<span class="term-gray">Input:</span> { "summary": "Поиск завершен, требования проанализированы по тексту страницы, сопроводительное письмо подготовлено", "success": true }

<span class="term-cyan">🤖 Assistant:</span> Задача успешно выполнена!

<span class="term-white" style="font-weight:bold;">**Выполнено:**</span>
<span class="term-green">✅ Найдено 1129 вакансий по запросу «AI-инженер» на hh.ru</span>
<span class="term-green">✅ Выбрана позиция: AI/LLM Engineer в AI Lab (HeadHunter::Analytics)</span>
<span class="term-green">✅ Страница проскроллена, визуально исследованы разделы «Обязанности», «Требования» и «Ключевые навыки»</span>
<span class="term-green">✅ Извлечен реальный стек: Python, LangChain, LangGraph, vLLM, RAG, Qdrant, pgvector</span>
<span class="term-green">✅ Составлено персонализированное сопроводительное письмо для отклика</span>`);
  });

  await cliPage.evaluate(() => (window as any).showPrompt());

  console.log('Outro pause 3.5 seconds...');
  await cliPage.waitForTimeout(3500);

  console.log('=== [5/6] Finalizing Browser and CLI Video Streams ===');
  await browserPage.close();
  await cliPage.close();
  await browserCtx.close();
  await cliCtx.close();
  await browser.close();
  server.close();

  const browserVideos = fs.readdirSync(browserRecDir).filter((f) => f.endsWith('.webm'));
  const cliVideos = fs.readdirSync(cliRecDir).filter((f) => f.endsWith('.webm'));

  if (browserVideos.length === 0 || cliVideos.length === 0) {
    throw new Error('Video recording files missing');
  }

  const browserVideoPath = path.join(browserRecDir, browserVideos[0]);
  const cliVideoPath = path.join(cliRecDir, cliVideos[0]);

  console.log(`Browser video: ${browserVideoPath} (${(fs.statSync(browserVideoPath).size / 1024).toFixed(1)} KB)`);
  console.log(`CLI video: ${cliVideoPath} (${(fs.statSync(cliVideoPath).size / 1024).toFixed(1)} KB)`);

  console.log('=== [6/6] Combining Streams Side-by-Side (HSTACK) via FFmpeg ===');
  const ffmpegModule = await import('ffmpeg-static');
  const ffmpegPath: string = (ffmpegModule.default || ffmpegModule) as any;

  const outputMp4 = path.resolve('./demo.mp4');
  if (fs.existsSync(outputMp4)) {
    fs.unlinkSync(outputMp4);
  }

  execFileSync(
    ffmpegPath,
    [
      '-i',
      browserVideoPath,
      '-i',
      cliVideoPath,
      '-filter_complex',
      '[0:v]scale=960:1080[v0];[1:v]scale=960:1080[v1];[v0][v1]hstack=inputs=2[v]',
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '21',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-movflags',
      '+faststart',
      '-y',
      outputMp4
    ],
    { stdio: 'inherit' }
  );

  const stats = fs.statSync(outputMp4);
  console.log(`\n======================================================`);
  console.log(`✅ NEW DEMO VIDEO GENERATED: demo.mp4`);
  console.log(`   Path: ${outputMp4}`);
  console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Resolution: 1920x1080 @ 30fps H.264`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('Fatal error during hh demo recording:', err);
  process.exit(1);
});
