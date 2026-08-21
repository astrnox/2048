const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
(async () => {
  const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('http://localhost:8123/game_ai.html', { waitUntil: 'networkidle0', timeout: 25000 });
  await new Promise(r => setTimeout(r, 500));

  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const state = async () => p.evaluate(() => {
    const max = el => Math.max(0, ...Array.from(el.querySelectorAll('.cell.has-tile')).map(c => parseInt(c.textContent) || 0));
    const banner = document.getElementById('banner');
    return {
      botMax: max(document.getElementById('board-b')),
      playerMax: max(document.getElementById('board-p')),
      banner: banner.style.display !== 'none' ? document.getElementById('banner-text').textContent : null
    };
  });

  let botBest = 0, playerBest = 0, moves = 0, result = null, botTimes = [];
  let lastT = Date.now();
  for (let i = 0; i < 500; i++) {
    // human plays randomly (sometimes skip to let bot build)
    if (Math.random() < 0.5) {
      await p.keyboard.press(keys[Math.floor(Math.random() * 4)]);
      await new Promise(r => setTimeout(r, 480)); // 420 bot thinking
    } else {
      await new Promise(r => setTimeout(r, 480));
    }
    const s = await state();
    botBest = Math.max(botBest, s.botMax); playerBest = Math.max(playerBest, s.playerMax);
    moves++;
    if (i % 20 === 0) botTimes.push(Date.now() - lastT); lastT = Date.now();
    if (s.banner) { result = s.banner; break; }
    if (i % 3 === 0) { // trim player board growth too
    }
  }
  const final = await state();
  console.log('moves=' + moves);
  console.log('botBestTile=' + botBest);
  console.log('playerBestTile=' + playerBest);
  console.log('result=' + (result || final.banner || 'no-banner-yet'));
  console.log('approx bot turn time over sampled windows(ms)=' + botTimes.join(','));
  await b.close();
})();