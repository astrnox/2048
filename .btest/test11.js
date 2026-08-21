const puppeteer = require('puppeteer-core');
const EXE = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
(async () => {
  const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('http://localhost:8123/game_ai.html', { waitUntil: 'networkidle0', timeout: 25000 });
  await p.evaluate(() => { localStorage.setItem('2048-botdiff', 'hard'); location.reload(); });
  await new Promise(r => setTimeout(r, 600));
  // time the aiAct decision: monkeypatch setTimeout to measure the aiAct call duration
  const times = [];
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'][i%4]);
    const t = await p.evaluate(() => {
      return new Promise(res => {
        // The aiAct runs after ~420ms; we detect a change in bot board or measure elapsed until next status
        const t0 = performance.now();
        const check = () => {
          const st = document.getElementById('ai-status').textContent;
          if (st === '你的回合' || st === '机器人赢了 · 再战一局？' || st === '机器人赢了') { res(Math.round(performance.now() - t0)); }
          else setTimeout(check, 20);
        };
        setTimeout(check, 380);
      });
    });
    times.push(t);
  }
  console.log('hard bot turn elapsed (click->idle, ms): ' + times.join(','));
  console.log('max=' + Math.max(...times));
  await b.close();
})();