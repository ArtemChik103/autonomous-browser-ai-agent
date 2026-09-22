import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });
  console.log('Navigating directly to vacancy search URL...');
  await page.goto('https://hh.ru/search/vacancy?text=AI-инженер', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  // Dismiss region modal if present
  const regionBtn = await page.$('button[data-qa="region-clarification-confirm"]');
  if (regionBtn) {
    console.log('Dismissing region modal...');
    await regionBtn.click();
    await page.waitForTimeout(500);
  }

  const firstVacancyLink = await page.$('a[data-qa="serp-item__title"]');
  if (firstVacancyLink) {
    const title = await firstVacancyLink.textContent();
    const href = await firstVacancyLink.getAttribute('href');
    console.log('Clicking vacancy:', title?.trim(), 'href:', href);
    
    // Open vacancy
    await page.goto(href || 'https://hh.ru', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    console.log('Vacancy page title:', await page.title());
    await page.screenshot({ path: 'screenshots/probe_hh_vacancy.png' });
  }

  await browser.close();
}

test().catch(console.error);
