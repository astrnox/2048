// Test hexagonal 2048 in a real browser.
const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const ok = (n, c) => console.log((c ? 'PASS' : 'FAIL') + '  ' + n);

  await page.setViewport({ width: 900, height: 900 });
  await page.goto('http://localhost:8080/game_hex.html', { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise(r => setTimeout(r, 300));

  let cnt = await page.evaluate(() => document.querySelectorAll('.hex-tile').length);
  ok('hex board renders tiles (cell count)', cnt >= 2 && cnt <= 19);

  const score0 = await page.evaluate(() => parseInt(document.querySelector('.score-container') ? null : 0) || 0);

  // Press several directions; board should respond (spawn/move), score may grow
  let grew = false, scoreGrew = false;
  const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyQ'];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(keys[i % keys.length]);
    await new Promise(r => setTimeout(r, 90));
    const st = await page.evaluate(() => ({
      n: document.querySelectorAll('.hex-tile').length,
      s: parseInt(document.querySelector('.score-container') || '0') || 0
    }));
    if (st.n > cnt) grew = true;
  }
  const score1 = await page.evaluate(() => parseInt(document.querySelector('.score-container').textContent) || 0);
  ok('movement responds + new tiles spawn', grew);
  ok('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.join(' | '));
  ok('layout intact / board present', await page.evaluate(() => !!document.querySelector('svg hexboard') || !!document.querySelector('.hex-board svg')));
  browser.close();
})();