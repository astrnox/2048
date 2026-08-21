// Reproduce why the gamemodes may "not play" in a real browser.
const puppeteer = require('puppeteer-core');

const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const log = [];
  const ok = (name, cond) => log.push((cond ? 'PASS' : 'FAIL') + '  ' + name);

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0', timeout: 30000 });

  const tilesAtStart = await page.$$eval('.tile', els => els.length);
  ok('initial board renders tiles', tilesAtStart >= 2);

  const bodyClass = await page.evaluate(() => document.body.className);
  ok('default mode body class', bodyClass === 'mode-classic');

  // Click the 限时挑战 mode button
  await page.click('.mode-button[data-mode="time"]');
  await new Promise(r => setTimeout(r, 300));
  const t = await page.evaluate(() => ({
    body: document.body.className,
    modeButtons: document.querySelectorAll('.mode-button').length,
    timerText: document.querySelector('.timer') ? document.querySelector('.timer').textContent : null,
    timerVisible: document.querySelector('.timer-container') ? getComputedStyle(document.querySelector('.timer-container')).display : null,
    tiles: document.querySelectorAll('.tile').length
  }));
  const { ChineseServer } = await Promise.resolve({});
  ok('time mode activated', t.body === 'mode-time');
  ok('mode buttons present', t.modeButtons === 3);
  ok('timer shows initial value', t.timerText === '1:00' || /^\d+:\d\d$/.test(t.timerText));
  ok('timer container visible in time mode', t.timerVisible !== 'none');
  ok('board still has tiles after switching', t.tiles >= 2);

  // Try to actually play: send arrow keys and see if tiles move / score changes
  const before = await page.evaluate(() => ({
    tiles: document.querySelectorAll('.tile').length,
    score: document.querySelector('.score-container').textContent
  }));

  let moved = false;
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('ArrowRight');
    await new Promise(r => setTimeout(r, 80));
    const now = await page.evaluate(() => ({
      tiles: document.querySelectorAll('.tile').length
    }));
    if (now.tiles > before.tiles) { moved = true; break; }
  }
  ok('arrow key adds tiles (game responds to input)', moved);

  // Countdown should tick
  await new Promise(r => setTimeout(r, 1500));
  const timerAfter = await page.evaluate(() => document.querySelector('.timer').textContent);
  ok('timer is counting down', timerAfter && timerAfter !== '1:00');

  log.forEach(l => console.log(l));
  console.log('\nJS errors observed:', errors.length ? errors.join(' | ') : 'none');
  browser.close();
})();