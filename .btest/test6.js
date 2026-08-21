const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
(async () => {
  const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 480, height: 820 });
  await p.goto('http://localhost:8123/game_hex.html', { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise(r => setTimeout(r, 400));
  const info = await p.evaluate(() => {
    const t = document.querySelector('.hex-tile');
    const board = document.querySelector('.hex-board');
    const bgCell = document.querySelector('.hex-board svg > g:first-child polygon');
    const cs = el => el ? getComputedStyle(el) : null;
    const poly = t ? getComputedStyle(t.querySelector('polygon')) : null;
    const txt = t ? getComputedStyle(t.querySelector('text')) : null;
    return {
      bodyBg: cs(document.body).backgroundImage.slice(0, 40),
      boardBg: board ? cs(board).backgroundColor : null,
      boardBorder: board ? cs(board).borderColor : null,
      cellFill: bgCell ? cs(bgCell).fill : null,
      tileStroke: poly ? poly.stroke : null,
      tileTrans: t ? cs(t).transitionDuration : null,
      tileColor: poly ? poly.fill : null,
      textFill: txt ? txt.fill : null,
      backLinkColor: cs(document.querySelector('.back-link')).color,
      sysColor: cs(document.querySelector('.cli-sys')).color,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await p.screenshot({ path: '/workspace/.btest/shot_hex.png' });
  await b.close();
})();