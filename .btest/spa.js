const puppeteer = require('puppeteer-core');
const BASE = 'http://localhost:8090';
const CHROME = '/opt/google/chrome/chrome';
const OUT = '/workspace/.btest/shots';
const fs = require('fs');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const report = {};

  for (const vp of [
    { name: 'd', width: 1280, height: 900 },
    { name: 'm', width: 390, height: 844, isMobile: true, hasTouch: true },
  ]) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    const errs = []; const warns = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text());
      else if (m.type() === 'warning') warns.push(m.text());
    });
    page.on('pageerror', (e) => errs.push('EXC: ' + e.message));

    report['home_' + vp.name] = { errs: [], warns: [] };

    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: `${OUT}/spa_home_${vp.name}.png` });

    // ---- 点击开始游戏 → 模式选择视图
    await page.click('.view-home [data-go="modes"]');
    await new Promise((r) => setTimeout(r, 420));
    await page.screenshot({ path: `${OUT}/spa_modes_${vp.name}.png` });

    // ---- 点击经典模式 → 子菜单
    await page.click('.view-modes [data-play="classic"]');
    await new Promise((r) => setTimeout(r, 420));
    await page.screenshot({ path: `${OUT}/spa_play_nosave_${vp.name}.png` });

    // ---- 写存档后重开 → 验证 continue + 确认框
    await page.evaluate(() => { localStorage.setItem('game_save', JSON.stringify({ v: 1 })); });
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 300));
    await page.click('.view-home [data-go="modes"]');
    await new Promise((r) => setTimeout(r, 350));
    await page.click('.view-modes [data-play="gravity"]');
    await new Promise((r) => setTimeout(r, 350));
    await page.screenshot({ path: `${OUT}/spa_play_hassave_${vp.name}.png` });
    await page.click('#btnNewGame'); // 弹出确认框
    await new Promise((r) => setTimeout(r, 350));
    await page.screenshot({ path: `${OUT}/spa_confirm_${vp.name}.png` });
    await page.click('[data-close-confirm].modal-cancel'); // 取消
    await new Promise((r) => setTimeout(r, 200));
    // 按 ESC 返回 modes
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 350));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 350));
    await page.screenshot({ path: `${OUT}/spa_backhome_${vp.name}.png` });

    // ---- 涟漪测试：检查点击后是否插入 ripple span
    await page.evaluate(() => { localStorage.removeItem('game_save'); });
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => {
      document.getElementById === null; // no-op
    });
    const rippleHits = await page.evaluate(async () => {
      const btn = document.querySelector('.view-home .btn-3d');
      btn.dispatchEvent(new PointerEvent('pointerdown', { clientX: btn.getBoundingClientRect().left + btn.offsetWidth/2, clientY: btn.getBoundingClientRect().top + btn.offsetHeight/2, bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      return btn.querySelectorAll('.ripple').length;
    });

    report['home_' + vp.name] = {
      errs, warns, rippleHits,
      // 横向溢出
      overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
    await page.close();
  }

  // 像素采样：验证配色
  const sample = await (async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: `${OUT}/spa_sample.png` });
    await page.close();
    return 'ok';
  })();

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})();
