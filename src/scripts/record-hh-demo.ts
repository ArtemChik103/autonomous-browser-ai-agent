import { chromium } from 'playwright';
import http from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { BrowserManager } from '../browser/browser-manager.js';
import { OrchestratorAgent } from '../agents/orchestrator.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function main() {
  console.log('================================================================');
  console.log('🚀 100% AUTONOMOUS BROWSER AGENT DEMO RECORDER (DUAL STREAM)');
  console.log('   - Real Chromium Browser (Left) with Action Visual Cursor');
  console.log('   - Real Terminal Stream (Right) Driven 100% by LLM Decisions');
  console.log('   - Zero Hardcoded Actions, Zero Pre-scripted Text');
  console.log('================================================================\n');

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

  console.log('=== [2/6] Launching Playwright Dual Recording Contexts ===');
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

  await browserCtx.addInitScript('window.__name = (t) => t;');
  await cliCtx.addInitScript('window.__name = (t) => t;');

  const browserPage = await browserCtx.newPage();
  const cliPage = await cliCtx.newPage();
  await browserPage.addInitScript('window.__name = (t) => t;');
  await cliPage.addInitScript('window.__name = (t) => t;');

  console.log('=== [3/6] Initializing Terminal View & Prompt Animation ===');
  await cliPage.goto(`http://localhost:${port}/terminal-view.html`, { waitUntil: 'networkidle' });
  await cliPage.waitForTimeout(800);

  const userGoal = 'Найди на hh.ru вакансию AI-инженера, изучи требования и подготовь сопроводительное письмо';
  const cliCommand = `pnpm start --task "${userGoal}"`;

  // Animate user typing the task command
  await cliPage.evaluate((cmd) => (window as any).typeInput(cmd, 22), cliCommand);
  await cliPage.waitForTimeout(500);
  await cliPage.evaluate(() => (window as any).hidePrompt());

  // Log user message
  await cliPage.evaluate((goal) => {
    (window as any).addLog(`\n<span class="term-cyan">👤 You:</span> <span class="term-white">${goal}</span>`);
  }, escapeHtml(userGoal));
  await cliPage.waitForTimeout(500);

  console.log('=== [4/6] Initializing Autonomous BrowserManager & OrchestratorAgent ===');
  const browserManager = new BrowserManager(false, browserPage, browserCtx);
  browserManager.setVisualCursor(true);

  const sendToTerminal = async (html: string) => {
    try {
      await cliPage.evaluate((h) => (window as any).addLog(h), html);
    } catch (err: any) {
      console.warn('Failed to send log to terminal view:', err.message);
    }
  };

  const agent = new OrchestratorAgent(browserManager, {
    async onAssistantThought(text) {
      if (text.trim()) {
        console.log(`\n[Assistant Thought]: ${text}`);
        await sendToTerminal(`<span class="term-cyan">🤖 Assistant:</span> ${escapeHtml(text)}`);
        await cliPage.waitForTimeout(500);
      }
    },
    async onToolStart(name, input) {
      console.log(`\n[Tool Start]: ${name} ${JSON.stringify(input)}`);
      await sendToTerminal(
        `<span class="term-gray">🔧 Using tool:</span> <span class="term-yellow">${escapeHtml(name)}</span>\n<span class="term-gray">Input:</span> ${escapeHtml(JSON.stringify(input, null, 2))}`
      );
      await cliPage.waitForTimeout(350);
    },
    async onToolEnd(name, result) {
      console.log(`[Tool End]: ${name} -> ${result.slice(0, 100)}...`);
      const preview = result.length > 320 ? result.slice(0, 320) + '...' : result;
      await sendToTerminal(
        `<span class="term-gray">Result:</span> <span class="term-green">${escapeHtml(preview)}</span>`
      );
      await cliPage.waitForTimeout(450);
    },
    async onSubAgentStart(query) {
      console.log(`\n[DOM Sub-agent Query]: ${query}`);
      await sendToTerminal(
        `<span class="term-magenta">🔍 DOM Sub-agent:</span> <span class="term-gray">${escapeHtml(query)}</span>`
      );
      await cliPage.waitForTimeout(400);
    },
    async onSubAgentEnd(result) {
      console.log(`[DOM Sub-agent Result]: ${result.slice(0, 100)}...`);
      const preview = result.length > 350 ? result.slice(0, 350) + '...' : result;
      await sendToTerminal(
        `<span class="term-gray">DOM Analysis:</span> ${escapeHtml(preview)}`
      );
      await cliPage.waitForTimeout(450);
    },
    async onSecurityWarning(reason) {
      console.warn(`[Security Warning]: ${reason}`);
      await sendToTerminal(
        `<span class="term-red">🛡️ [SECURITY WARNING]: ${escapeHtml(reason)}</span>`
      );
    },
    async onFinish(summary, items, resultContent) {
      console.log(`\n[Finish Task]: ${summary}`);
      if (resultContent) {
        console.log(`[Result Content/Letter]:\n${resultContent}`);
      }

      let finishHtml = `<span class="term-cyan">🤖 Assistant:</span> ${escapeHtml(summary)}`;
      if (resultContent && resultContent.trim()) {
        finishHtml += `\n<span class="term-green" style="font-weight:bold;">📝 Сопроводительное письмо:</span>\n<div class="letter-box">${escapeHtml(resultContent.trim())}</div>`;
      }
      if (items && items.length > 0) {
        finishHtml += `\n<span class="term-white" style="font-weight:bold;">**Выполнено:**</span>\n` +
          items.map((i) => `✅ ${escapeHtml(i)}`).join('\n');
      }

      await sendToTerminal(finishHtml);
      await cliPage.waitForTimeout(1000);
    }
  });

  console.log('=== [5/6] Executing Real Agent Autonomous Loop ===');
  try {
    await agent.run(userGoal, 25);
  } catch (err: any) {
    console.error('Agent execution encountered an error:', err.message);
    await sendToTerminal(`<span class="term-red">Ошибка агента: ${escapeHtml(err.message)}</span>`);
  }

  await cliPage.evaluate(() => (window as any).showPrompt());
  console.log('Outro pause 3.5 seconds...');
  await cliPage.waitForTimeout(3500);

  console.log('=== [6/6] Finalizing Video Recording and FFmpeg HSTACK ===');
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
  console.log(`✅ 100% AUTONOMOUS DEMO VIDEO GENERATED: demo.mp4`);
  console.log(`   Path: ${outputMp4}`);
  console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Resolution: 1920x1080 @ 30fps H.264`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('Fatal error during demo recording:', err);
  process.exit(1);
});
