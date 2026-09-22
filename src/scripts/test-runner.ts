import { SafetyGuard } from '../security/safety-guard.js';
import { GeminiClient } from '../llm/client.js';
import { config } from '../config.js';
import { BrowserManager } from '../browser/browser-manager.js';
import { extractInteractiveElements } from '../browser/dom-extractor.js';

async function runTests() {
  console.log('=== ЗАПУСК ВЕРИФИКАЦИОННЫХ ТЕСТОВ СИСТЕМЫ ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Тестирование Security Layer (Safety Guard)
  console.log('--- 1. Тестирование Security Guard ---');
  const guard = new SafetyGuard();
  guard.setUserGoal('Найди хот-дог в лавке, добавь в корзину, не оплачивай');

  const clickSafe = guard.checkAction('click_element', { selector: 'button.add-to-cart' }, 'Добавляю в корзину');
  assert(clickSafe.allowed === true, 'Разрешен безопасный клик добавления в корзину');

  const clickPay = guard.checkAction('click_element', { selector: 'button.pay-order' }, 'Нажимаю Оплатить 450 руб');
  assert(clickPay.allowed === false, 'Блокируется клик по кнопке оплаты ("не оплачивай")');

  const typeCard = guard.checkAction('type_text', { selector: 'input.card-number', text: '4276 1234 5678 9012' });
  assert(typeCard.allowed === false, 'Блокируется ввод данных банковской карты');

  // 2. Тестирование Gemini Client & Tool Calling API
  console.log('\n--- 2. Тестирование Gemini API & Tool Calling ---');
  try {
    const client = new GeminiClient(config.geminiApiKey, config.orchestratorModel);
    const testRes = await client.generateContent(
      [{ role: 'user', parts: [{ text: 'Перейди на https://example.com' }] }],
      [
        {
          name: 'navigate_to_url',
          description: 'Navigate to URL',
          parameters: {
            type: 'OBJECT',
            properties: { url: { type: 'STRING' } },
            required: ['url']
          }
        }
      ],
      'Ты — браузерный агент. Если пользователь просит перейти по адресу, вызови navigate_to_url.'
    );

    assert(Boolean(testRes.functionCall), 'Gemini успешно вернул functionCall');
    assert(testRes.functionCall?.name === 'navigate_to_url', `Вызван корректный инструмент: ${testRes.functionCall?.name}`);
    assert(Boolean(testRes.functionCall?.args?.url), `Передан корректный аргумент: ${testRes.functionCall?.args?.url}`);
  } catch (err: any) {
    console.error('Ошибка в тесте Gemini:', err.message);
    failed++;
  }

  // 3. Тестирование Browser Manager и DOM Extractor (Headless для CI)
  console.log('\n--- 3. Тестирование Browser & DOM Extractor ---');
  const browser = new BrowserManager(true); // Headless for fast test
  try {
    await browser.init();
    await browser.navigate('https://example.com');
    const screenshot = await browser.takeScreenshot();
    assert(Boolean(screenshot), `Скриншот успешно сохранен: ${screenshot}`);

    const domInfo = await extractInteractiveElements(browser.getPage());
    assert(domInfo.elements.length > 0, `DOM Extractor нашел ${domInfo.elements.length} интерактивных элементов`);
    assert(domInfo.elements.some(el => el.tagName === 'a' && (el.text.toLowerCase().includes('more') || el.text.toLowerCase().includes('learn') || el.text.length > 0)), 'Найден интерактивный элемент ссылки');
    await browser.close();
  } catch (err: any) {
    console.error('Ошибка в тесте браузера:', err.message);
    failed++;
    await browser.close().catch(() => {});
  }

  console.log(`\nИТОГ ТЕСТОВ: Пройдено: ${passed}, Ошибок: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Фатальный сбой тестов:', err);
  process.exit(1);
});
