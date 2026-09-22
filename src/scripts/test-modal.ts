import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 960, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });
  console.log('Navigating to https://hh.ru...');
  await page.goto('https://hh.ru', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a, [data-qa]'));
    const matches = buttons
      .filter((el) => {
        const qa = el.getAttribute('data-qa') || '';
        const aria = el.getAttribute('aria-label') || '';
        const txt = el.textContent?.trim() || '';
        return (
          qa.includes('modal') ||
          qa.includes('close') ||
          aria.includes('закры') ||
          aria.includes('Закры') ||
          txt === '✕' ||
          txt === '×' ||
          txt.includes('Я ищу работу')
        );
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        qa: el.getAttribute('data-qa'),
        aria: el.getAttribute('aria-label'),
        text: el.textContent?.trim().slice(0, 40),
        className: el.className
      }));

    return {
      title: document.title,
      matches
    };
  });

  console.log('Matched modal elements:\n', JSON.stringify(info, null, 2));

  console.log('Clicking signup-modal-close button...');
  const closeBtn = await page.$('button[data-qa="signup-modal-close"]');
  if (closeBtn) {
    await closeBtn.click();
    console.log('Close button clicked!');
  } else {
    console.log('Close button not found!');
  }
  await page.waitForTimeout(1000);

  const afterClick = await page.evaluate(() => {
    const signupModal = document.querySelector('[data-qa="signup-modal-close"]');
    return {
      hasModalAfterClick: !!signupModal
    };
  });
  console.log('After Click:', JSON.stringify(afterClick));

  await browser.close();
}

test().catch(console.error);
