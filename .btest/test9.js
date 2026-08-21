const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
const BASE = 'http://localhost:8123/';
const PAGES = ['index.html','game.html','game_hex.html','game_gravity.html','game_growth.html','game_ai.html'];
(async () => {
  const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true });
  for (const pg of PAGES) {
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + pg, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise(r => setTimeout(r, 300));
    const sz = await p.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      hasBack: !!document.querySelector('.cli-bar .back-link') || !!document.querySelector('.back-link')
    }));
    console.log((errs.length ? 'ERR:'+errs.join('|') : 'ok') + '  ' + pg + '  back=' + sz.hasBack + '  noHoverflow=' + (sz.scrollW <= sz.winW + 1));
    p.removeAllListeners('pageerror');
  }
  await b.close();
})();