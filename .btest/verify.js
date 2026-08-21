const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:8090';
const CHROME = '/opt/google/chrome/chrome';
const OUT = '/workspace/.btest/shots';

const pages = [
  ['index.html', 'home'],
  ['game.html', 'classic'],
  ['game_gravity.html', 'gravity'],
  ['game_growth.html', 'growth'],
  ['game_hex.html', 'hex'],
  ['game_ai.html', 'ai'],
];

const viewports = [
  { name: 'd', width: 1280, height: 900 },
  { name: 'm', width: 390, height: 844, isMobile: true, hasTouch: true },
];

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const report = {};

  for (const [file, name] of pages) {
    report[name] = { console: [], errors: [] };
    for (const vp of viewports) {
      const page = await browser.newPage();
      await page.setViewport(vp);
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') {
          report[name].console.push(`[${vp.name}] ${m.type()}: ${m.text()}`);
        }
      });
      page.on('pageerror', (e) => {
        report[name].errors.push(`[${vp.name}] ${e.message}`);
      });
      try {
        await page.goto(`${BASE}/${file}`, { waitUntil: 'networkidle0', timeout: 15000 });
        // 关闭首次进入的教学弹层（如有）
        await page.evaluate(() => {
          localStorage.setItem('gravity-howto', '1');
          const h = document.getElementById('howto');
          if (h) h.classList.remove('show');
        });
        await new Promise((r) => setTimeout(r, 700));
        await page.screenshot({ path: `${OUT}/${name}_${vp.name}.png` });
        // 横向溢出检测
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) report[name].errors.push(`[${vp.name}] horizontal overflow: ${overflow}px`);
      } catch (e) {
        report[name].errors.push(`[${vp.name}] load fail: ${e.message}`);
      }
      await page.close();
    }
  }

  // ---------- 交互测试：模拟游玩 ----------
  async function play(file, name, keys) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${BASE}/${file}`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.setItem('gravity-howto', '1');
      const h = document.getElementById('howto');
      if (h) h.classList.remove('show');
    });
    await new Promise((r) => setTimeout(r, 400));
    for (const k of keys) {
      await page.keyboard.press(k);
      await new Promise((r) => setTimeout(r, 160));
    }
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: `${OUT}/${name}_play.png` });
    if (errs.length) report[name].errors.push(`play: ${errs.join(' | ')}`);
    await page.close();
  }

  await play('game_gravity.html', 'gravity', ['ArrowLeft', 'Space', 'ArrowRight', 'Space', 'ArrowRight', 'Space']);
  await play('game_growth.html', 'growth', ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']);
  await play('game_hex.html', 'hex', ['ArrowUp', 'KeyQ', 'KeyE', 'ArrowDown', 'KeyQ', 'KeyE']);
  await play('game_ai.html', 'ai', ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown']);
  await play('game.html', 'classic', ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']);

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})();
