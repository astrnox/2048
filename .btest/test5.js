// Verify all game modes: no JS errors, unified cli UI, and animations fire.
const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
const BASE = 'http://localhost:8123/';

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const report = [];
  const ok = (name, cond, extra) => report.push((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));

  const load = async (path) => {
    const errors = [];
    const onErr = e => errors.push('PAGEERROR: ' + e.message);
    const onCons = m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); };
    page.on('pageerror', onErr);
    page.on('console', onCons);
    await page.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 25000 });
    await sleep(350);
    page.off('pageerror', onErr);
    page.off('console', onCons);
    return errors;
  };

  const uni = await page.evaluate(() => {
    const q = s => document.querySelector(s);
    return {
      cliBar: !!q('.cli-bar'),
      backLink: !!q('.cli-bar .back-link'),
      backHref: q('.cli-bar .back-link') ? q('.cli-bar .back-link').getAttribute('href') : null,
      sys: !!q('.cli-bar .cli-sys'),
      restartBtn: !!q('.btn.btn-primary'),
    };
  });

  // 1) index
  let e = await load('index.html');
  ok('index loads clean', e.length === 0, e.join('|'));

  // 2) classic game.html
  e = await load('game.html');
  ok('game.html loads clean', e.length === 0, e.join('|'));
  let u = await page.evaluate(() => {
    const q = s => document.querySelector(s);
    return {
      cliBar: !!q('.cli-bar'), backLink: !!q('.cli-bar .back-link'),
      sys: !!q('.cli-bar .cli-sys'),
      hasTut: !!q('.cli-tut') || /移动/.test(document.body.innerText),
      hasGame: !!q('.board') || !!q('.tile-container'),
    };
  });
  ok('game: cli bar + back link', u.cliBar && u.backLink);
  ok('game: keeps game board + tutorial', u.hasGame && u.hasTut);
  await page.screenshot({ path: '/workspace/.btest/shot_classic.png' });

  // 3) hex
  e = await load('game_hex.html');
  ok('game_hex loads clean', e.length === 0, e.join('|'));
  u = await page.evaluate(() => {
    const q = s => document.querySelector(s);
    return {
      cliBar: !!q('.cli-bar'), backLink: !!q('.back-link'), restart: !!q('#restart.btn'),
      tiles: document.querySelectorAll('.hex-tile').length,
    };
  });
  ok('hex: unified cli + shared restart btn', u.cliBar && u.backLink && u.restart);
  ok('hex: tiles rendered', u.tiles >= 2);
  // simulate moves; capture if new/merged animation classes appear
  let sawNew = false, sawMerged = false, spawntotal = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyQ'][i % 6]);
    await sleep(60);
    const st = await page.evaluate(() => ({
      cls: Array.from(document.querySelectorAll('.hex-tile')).map(x => x.getAttribute('class')).join(' '),
      n: document.querySelectorAll('.hex-tile').length,
    }));
    if (/hex-new/.test(st.cls)) sawNew = true;
    if (/hex-merged/.test(st.cls)) sawMerged = true;
    if (st.n > spawntotal) spawntotal = st.n;
  }
  ok('hex: new tile animation class fires', sawNew);
  ok('hex: merged animation class fires', sawMerged);
  await page.screenshot({ path: '/workspace/.btest/shot_hex.png' });

  // 4) gravity
  e = await load('game_gravity.html');
  ok('game_gravity loads clean', e.length === 0, e.join('|'));
  // dismiss howto if shown
  await page.evaluate(() => { const h = document.getElementById('howto'); if (h) h.classList.remove('show'); });
  let sawTnew = false, sawSettle = false, sawChain = false;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Space');
    await sleep(70);
    const st = await page.evaluate(() => ({
      cls: Array.from(document.querySelectorAll('#board-grav .gcell')).map(x => x.className).join(' '),
    }));
    if (/t-new/.test(st.cls)) sawTnew = true;
    if (/g-settle/.test(st.cls)) sawSettle = true;
    if (/g-chain/.test(st.cls)) sawChain = true;
  }
  ok('gravity: new-star emerge anim (t-new)', sawTnew);
  ok('gravity: falling settle anim (g-settle)', sawSettle);
  ok('gravity: chain merge anim (g-chain)', sawChain);
  await page.screenshot({ path: '/workspace/.btest/shot_gravity.png' });

  // 5) growth + ai
  for (const [path, name] of [['game_growth.html', 'growth'], ['game_ai.html', 'ai']]) {
    e = await load(path);
    ok(name + ' loads clean', e.length === 0, e.join('|'));
    const u2 = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      return { cliBar: !!q('.cli-bar'), backLink: !!q('.back-link'), hasRestart: !!q('.btn.btn-primary') };
    });
    ok(name + ': unified cli + back + restart btn', u2.cliBar && u2.backLink && u2.hasRestart);
    await page.screenshot({ path: '/workspace/.btest/shot_' + name + '.png' });
  }

  report.forEach(l => console.log(l));
  await browser.close();
})();