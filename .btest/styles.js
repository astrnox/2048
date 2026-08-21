const puppeteer = require('puppeteer-core');
const BASE = 'http://localhost:8090';
const CHROME = '/opt/google/chrome/chrome';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const out = {};

  // ---- hex: 分数 id 修复验证 ----
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(`${BASE}/game_hex.html`, { waitUntil: 'networkidle0' });
    await p.keyboard.press('ArrowUp');
    await new Promise((r) => setTimeout(r, 400));
    out.hex = await p.evaluate(() => ({
      scoreText: document.getElementById('hex-score')?.textContent,
      bestText: document.getElementById('hex-best')?.textContent,
      tiles: document.querySelectorAll('.hex-tile').length,
      tileAnim: getComputedStyle(document.querySelector('.hex-tile')).transitionProperty,
      boardBg: getComputedStyle(document.querySelector('.hex-board')).backgroundImage.slice(0, 60),
    }));
    await p.close();
  }

  // ---- gravity: 旋转 + nudge 共存 ----
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(`${BASE}/game_gravity.html`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => localStorage.setItem('gravity-howto', '1'));
    await p.reload({ waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 300));
    // 转向两次
    await p.keyboard.press('ArrowLeft');
    await new Promise((r) => setTimeout(r, 500));
    const rot1 = await p.evaluate(() => document.querySelector('.board').style.transform);
    // 触发坠落 nudge
    await p.keyboard.press('Space');
    await new Promise((r) => setTimeout(r, 100));
    const nudgeCls = await p.evaluate(() => document.querySelector('.starpit').className);
    await new Promise((r) => setTimeout(r, 500));
    const afterNudge = await p.evaluate(() => ({
      cls: document.querySelector('.starpit').className,
      anim: getComputedStyle(document.querySelector('.starpit')).animationName,
      boardTransform: document.querySelector('.board').style.transform,
      boardAnim: getComputedStyle(document.querySelector('.board')).animationName,
    }));
    out.gravity = { rot1, nudgeCls, afterNudge };
    await p.close();
  }

  // ---- growth: 种子动画 & 花圃 ----
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(`${BASE}/game_growth.html`, { waitUntil: 'networkidle0' });
    await p.keyboard.press('ArrowUp');
    await new Promise((r) => setTimeout(r, 300));
    out.growth = await p.evaluate(() => {
      const garden = document.querySelector('.garden');
      const seed = document.querySelector('.bcell.seed');
      return {
        gardenAnim: getComputedStyle(garden).animationName,
        seedCount: document.querySelectorAll('.bcell.seed').length,
        seedAfter: seed ? getComputedStyle(seed, '::after').animationName : null,
        tileShadow: getComputedStyle(document.querySelector('.bcell.t2, .bcell.t4, .bcell.t8')).boxShadow.slice(0, 40),
        basketBg: getComputedStyle(document.querySelector('.basket')).backgroundImage.slice(0, 40),
      };
    });
    await p.close();
  }

  // ---- ai: 棋盘 & chip ----
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(`${BASE}/game_ai.html`, { waitUntil: 'networkidle0' });
    await p.keyboard.press('ArrowUp');
    await new Promise((r) => setTimeout(r, 800));
    out.ai = await p.evaluate(() => ({
      statBg: getComputedStyle(document.querySelector('.stat')).backgroundImage.slice(0, 40),
      cellShadow: getComputedStyle(document.querySelector('.cell.has-tile')).boxShadow.slice(0, 40),
      vsRound: getComputedStyle(document.querySelector('.vs')).borderRadius,
      botMoved: document.querySelectorAll('.side.bot .cell.has-tile').length,
    }));
    await p.close();
  }

  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
