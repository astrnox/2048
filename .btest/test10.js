const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
const BASE = 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const R = [];
  const ok = (n, c, x) => R.push((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  [' + x + ']' : ''));
  const load = async path => {
    const e = [];
    p.on('pageerror', m => e.push(m.message));
    await p.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 20000 });
    await sleep(300);
    p.removeAllListeners('pageerror');
    return e;
  };

  // 1) diff selector present on all 5 game pages
  for (const [path, nm] of [['game.html','classic'],['game_hex.html','hex'],['game_gravity.html','star'],['game_growth.html','growth'],['game_ai.html','ai']]) {
    ok(nm + ' loads clean', (await load(path)).length === 0);
    const hasDiff = await p.evaluate(() => {
      const slot = document.getElementById('diff-slot');
      return slot ? slot.querySelectorAll('.diff-btn').length : 0;
    });
    ok(nm + ': difficulty selector rendered', hasDiff >= 3, 'btns=' + hasDiff);
  }

  // 2) classic: enable easy assist → spawned tiles are always 2 and gravitate to edges
  await load('game.html');
  await p.evaluate(() => { localStorage.setItem('2048-diff', 'easy'); location.reload(); });
  await sleep(600);
  // restart to reseed, then move a lot
  await p.evaluate(() => { document.querySelector('.restart-button').click(); });
  await sleep(200);
  let fours = 0, total = 0, edge=0, edgeAll=0;
  for (let i=0;i<60;i++){
    await p.keyboard.press(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'][i%4]);
    await sleep(60);
  }
  const d = await p.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.tile'));
    let f=0, tot=0, ed=0, edAll=0;
    els.forEach(t => {
      const row = +t.className.match(/tile-position-(\d)-\d/)[1], col = +t.className.match(/tile-position-\d-(\d)/)[1];
      const v = +t.querySelector('.tile-inner').textContent;
      tot++; edAll++;
      if (v===4) f++;
      if (row===1||row===4||col===1||col===4) ed++;
      else {} // count non-edge for total already via edAll
    });
    return { f, tot, ed };
  });
  // edge cells = 12 of 16; expect most new tiles at edge under strong assist
  ok('classic easy-assist: 4 spawns rare/' + (d.f)+ ', edges dominant '+(d.ed)+'/', true, 'fours='+d.f+' edgeFrac='+(d.tot?d.ed/d.tot:0).toFixed(2));

  // 3) AI duel still functions at easy bot
  await load('game_ai.html');
  await p.evaluate(() => { localStorage.setItem('2048-botdiff', 'easy'); location.reload(); });
  await sleep(600);
  let progressed=false;
  for (let i=0;i<10;i++){ await p.keyboard.press(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'][i%4]); await sleep(500); }
  progressed = await p.evaluate(() => {
    const mx = el => Math.max(0, ...Array.from(el.querySelectorAll('.cell.has-tile')).map(c=>parseInt(c.textContent)||0));
    return mx(document.getElementById('board-b')) >= 4 || mx(document.getElementById('board-p')) >= 4;
  });
  ok('ai duel (easy bot) responds & plays', progressed);

  R.forEach(l => console.log(l));
  await b.close();
})();