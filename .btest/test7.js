const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
const BASE = 'http://localhost:8123/';

(async () => {
  const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const p = await b.newPage();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = [];
  const ok = (n, c, x) => R.push((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  [' + x + ']' : ''));

  const load = async path => {
    const errs = [];
    const e1 = m => errs.push(m.message), e2 = m => { if (m.type() === 'error') errs.push(m.text()); };
    p.on('pageerror', e1); p.on('console', e2);
    await p.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 25000 });
    await sleep(350);
    p.off('pageerror', e1); p.off('console', e2);
    return errs;
  };

  // Beige theme check helper
  const theme = async () => p.evaluate(() => {
    const cs = el => getComputedStyle(el);
    const body = cs(document.body).backgroundColor;
    return { body, board: (() => {
      const el = document.querySelector('.board') || document.querySelector('.game-container') || document.querySelector('.hex-board') || document.querySelector('.garden');
      return el ? cs(el).backgroundColor : null; })() };
  });

  // 1) index
  ok('index loads clean', (await load('index.html')).length === 0);
  let t = await theme();
  ok('index beige body', /238, 248, 239|250, 248, 239/.test(t.body), t.body);
  await p.screenshot({ path: '/workspace/.btest/h_index.png' });

  // 2) classic
  ok('game.html loads clean', (await load('game.html')).length === 0);
  let hasBoard = await p.evaluate(() => !!document.querySelector('.game-container .tile-container') && !!document.querySelector('.grid-container'));
  t = await theme();
  ok('classic: board kept', hasBoard);
  ok('classic: beige board #bbada0', /187, 173, 160/.test(t.board), t.board);
  await p.screenshot({ path: '/workspace/.btest/h_classic.png' });

  // 3) hex — verify new tiles NOT clustered at origin; positions distributed
  ok('hex loads clean', (await load('game_hex.html')).length === 0);
  t = await theme();
  ok('hex: beige board', /187, 173, 160/.test(t.board), t.board);
  const hexPosOk = await (async () => {
    await p.keyboard.press('ArrowRight'); await sleep(120);
    const res = await p.evaluate(() => Array.from(document.querySelectorAll('.hex-tile')).map(g => g.style.transform));
    // if any tile has a translate not near (0,0), position is on-grid
    return res.some(s => s && !/\b0(\.0+)?px,\s*0(\.0+)?px/.test(s.replace('translate(','')) && /px.*px/.test(s));
  })();
  ok('hex: tiles positioned on-grid (not clumped at origin)', hexPosOk);
  let hexSpread = false;
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press(['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','KeyW','KeyQ'][i%6]);
    await sleep(55);
    const s = await p.evaluate(() => Array.from(document.querySelectorAll('.hex-tile')).map(g => g.style.transform).join('|'));
    const trs = s.split('|').filter(x => /translate/.test(x));
    if (trs.length >= 3 && new Set(trs).size >= 3) hexSpread = true;
  }
  ok('hex: multiple tiles occupy distinct cells', hexSpread);
  await p.screenshot({ path: '/workspace/.btest/h_hex.png' });

  // 4) gravity — fall animation classes fire
  ok('gravity loads clean', (await load('game_gravity.html')).length === 0);
  await p.evaluate(() => { const h = document.getElementById('howto'); if (h) h.classList.remove('show'); });
  let sawSettle = false, sawNew = false;
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press('Space'); await sleep(60);
    const cls = await p.evaluate(() => Array.from(document.querySelectorAll('#board-grav .gcell')).map(x => x.className).join(' '));
    if (/g-settle/.test(cls)) sawSettle = true;
    if (/t-new/.test(cls)) sawNew = true;
  }
  ok('gravity: fall/settle anim (g-settle)', sawSettle);
  ok('gravity: new-star anim (t-new)', sawNew);
  await p.screenshot({ path: '/workspace/.btest/h_gravity.png' });

  // 5) growth + ai load clean + beige
  for (const [path, nm] of [['game_growth.html','growth'], ['game_ai.html','ai']]) {
    ok(nm + ' loads clean', (await load(path)).length === 0);
    t = await theme();
    ok(nm + ': beige board', /187, 173, 160/.test(t.board), t.board);
    await p.screenshot({ path: '/workspace/.btest/h_' + nm + '.png' });
  }

  R.forEach(l => console.log(l));
  await b.close();
})();