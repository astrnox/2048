// Detect overlap / overflow issues across viewports.
const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const log = [];

  function intersect(a, b) {
    return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  }

  async function probe(url, w) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise(r => setTimeout(r, 250));
    return page.evaluate(() => {
      function rect(sel) { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; }
      return {
        docWidth: document.documentElement.scrollWidth,
        viewWidth: document.documentElement.clientWidth,
        horizOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        title: rect('h1.title'),
        homeLink: rect('.home-link'),
        scores: rect('.scores-container'),
        modeSel: rect('.mode-selector'),
        timerCon: rect('.timer-container'),
        cards: rect('.cards') ? [...document.querySelectorAll('.card')].map(c => { const r = c.getBoundingClientRect(); return { left: r.left, right: r.right, w: r.width }; }) : null
      };
    });
  }

  for (const w of [375, 768, 1280]) {
    // Homepage
    const home = await probe('http://localhost:8080/', w);
    log.push(`[${w}px homepage] overflow=${home.horizOverflow}` + (home.cards ? ` firstCardW=${Math.round(home.cards[0].w)}` : ''));

    // Game classic
    const g = await probe('http://localhost:8080/game.html?mode=classic', w);
    const linkTitle = g.homeLink && g.title ? intersect(g.homeLink, g.title) : false;
    const linkScores = g.homeLink && g.scores ? intersect(g.homeLink, g.scores) : false;
    log.push(`[${w}px classic] overflow=${g.horizOverflow} homeLink∋title=${linkTitle} homeLink∋scores=${linkScores}`);
    log.push(`  title=${g.title ? Math.round(g.title.w) + 'w,L' + Math.round(g.title.left) : '-'} homeLink=${g.homeLink ? 'L' + Math.round(g.homeLink.left) + ',w' + Math.round(g.homeLink.w) : '-'} scores=${g.scores ? 'R' + Math.round(g.scores.right) : '-'}`);

    // Game time
    const t = await probe('http://localhost:8080/game.html?mode=time', w);
    const timer = t.timerCon && t.timerCon.h > 0;
    log.push(`[${w}px time] tooltipTimerShown=${timer} modeSelOverflow=${Math.round((t.modeSel ? t.modeSel.right : 0)) > w}`);
  }

  log.forEach(l => console.log(l));
  browser.close();
})();