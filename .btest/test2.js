// Test the new homepage + card links + URL-mode flow in a real browser.
const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const log = [];
  const ok = (n, c) => log.push((c ? 'PASS' : 'FAIL') + '  ' + n);

  // 1) Homepage renders with clickable cards
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0', timeout: 30000 });
  ok('homepage has 3 mode cards', await page.$$('.card').then(a => a.length === 3));
  const links = await page.$$eval('.card', els => els.map(e => e.getAttribute('href')));
  ok('cards link into game.html modes',
     links.includes('game.html?mode=classic') && links.includes('game.html?mode=time') && links.includes('game.html?mode=endless'));

  // 2) Click the time card -> navigate to game page in time mode
  await page.click('.card-time');
  await new Promise(r => setTimeout(r, 400));
  ok('navigated to game.html?mode=time', page.url().includes('game.html?mode=time'));
  await new Promise(r => setTimeout(r, 300));
  const st = await page.evaluate(() => ({
    body: document.body.className,
    tiles: document.querySelectorAll('.tile').length,
    timer: document.querySelector('.timer') ? document.querySelector('.timer').textContent : null,
    timerShown: document.querySelector('.timer-container') ? getComputedStyle(document.querySelector('.timer-container')).display : null
  }));
  ok('time mode active after click', st.body === 'mode-time');
  ok('board has tiles on game page', st.tiles >= 2);
  ok('timer visible & ticking display', st.timerShown !== 'none' && /^\d+:\d\d$/.test(st.timer));
  const t1 = st.timer;
  await new Promise(r => setTimeout(r, 1200));
  const t2 = await page.evaluate(() => document.querySelector('.timer').textContent);
  ok('timer counts down', t1 !== t2);

  // 3) Direct URL to endless mode works
  await page.goto('http://localhost:8080/game.html?mode=endless', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 300));
  ok('endless mode from URL', await page.evaluate(() => document.body.className === 'mode-endless'));

  // 4) In-page mode switch works
  await page.click('.mode-button[data-mode="classic"]');
  await new Promise(r => setTimeout(r, 300));
  ok('in-page switch to classic', await page.evaluate(() => document.body.className === 'mode-classic'));

  // 5) Game responds to input on the time page
  await page.goto('http://localhost:8080/game.html?mode=time', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 200));
  const cnt0 = await page.evaluate(() => document.querySelectorAll('.tile').length);
  let grew = false;
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('ArrowDown');
    await new Promise(r => setTimeout(r, 70));
    if ((await page.evaluate(() => document.querySelectorAll('.tile').length)) > cnt0) { grew = true; break; }
  }
  ok('game playable (input adds tiles)', grew);

  log.forEach(l => console.log(l));
  console.log('\nJS errors:', errors.length ? errors.join(' | ') : 'none');
  browser.close();
})();