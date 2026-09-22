import { chromium } from 'playwright';
import path from 'path';
import { config } from '../config.js';

async function authSession() {
  console.log('Запуск браузера в режиме сохранения сессии...');
  console.log(`Профиль сессии: ${config.userDataDir}`);
  console.log('Вы можете войти в свои аккаунты (Яндекс, hh.ru, почта).');
  console.log('После входа просто закройте окно браузера — куки сохранятся автоматически.\n');

  const context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: false,
    viewport: config.viewport,
    args: ['--start-maximized']
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await page.goto('https://ya.ru');

  await new Promise<void>((resolve) => {
    context.on('close', () => {
      console.log('Браузер закрыт. Сессия сохранена.');
      resolve();
    });
  });
}

authSession().catch(console.error);
