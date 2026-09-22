import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });
  await page.goto('https://hh.ru/vacancy/137383315', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const sections = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const startIdx = lines.findIndex(l => l.includes('Чем предстоит заниматься') || l.includes('Обязанности') || l.includes('В AI Lab мы создаем'));
    return lines.slice(startIdx, startIdx + 35);
  });

  console.log('Sections:\n', sections.join('\n'));
  await browser.close();
}

main().catch(console.error);
