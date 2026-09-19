/* =============================================================
   2048 肉鸽 · 首页 SPA 路由
   - 视图切换（home / modes / play / rank / settings），带滑入滑出
   - 涟漪、确认框、game_save 存档检查
   - 排行榜：经典最佳 + 今日每日最佳
   - 设置：音效开关 + 清档
   - 键盘：↑↓ 移动焦点，Enter/Space 确认，数字键直选玩法，ESC 返回
   ============================================================= */
(function () {
  'use strict';

  // ---------- 常量 ----------
  var SLIDE_MS = 300;
  // 经典模式真正的存档键（对应 classic 页面 LocalStorageManager 的 gameState）
  var SAVE_KEY = 'gameState';
  var BEST_KEY = 'bestScore';
  var SOUND_KEY = '2048-sound';
  var MODE_MAP = {
    classic: { label: '经典模式', url: 'game.html' },
    gravity: { label: '星落引力', url: 'game_gravity.html' },
    hex:     { label: '蜂窝六边形', url: 'game_hex.html' },
    ai:      { label: '人机对抗', url: 'game_ai.html' },
    quantum: { label: '量子叠加', url: 'game_quantum.html' },
    dive:    { label: '整除合成', url: 'game_dive.html' },
    fib:     { label: '斐波那契', url: 'game_fib.html' }
  };

  // ---------- 状态 ----------
  var currentMode = 'classic';

  // ---------- 工具 ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, v) {
    try { window.localStorage.setItem(key, v); } catch (e) {}
  }
  function lsRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) {}
  }

  function hasSave() {
    var v = lsGet(SAVE_KEY);
    return v !== null && v !== undefined && v !== '';
  }

  // 每日纪录键：与 game_manager.js 的 dailyKey 保持一致
  function dailyKey() {
    var d = new Date();
    return '2048-daily-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // ---------- 视图切换 ----------
  function goView(next, back) {
    var current = $('.view.is-active');
    var nextEl  = $('.view[data-view="' + next + '"]');
    if (!nextEl) return;
    if (current && current === nextEl) return;

    // 切换 aria-hidden
    $$('.view').forEach(function (v) {
      v.setAttribute('aria-hidden', v === nextEl ? 'false' : 'true');
    });

    // 动画类
    if (current) {
      current.classList.add(back ? 'is-leaving-left' : 'is-leaving-right');
    }
    nextEl.classList.add('is-active');
    nextEl.classList.add(back ? 'is-entering-left' : 'is-entering-right');

    // 结束清理
    setTimeout(function () {
      if (current) {
        current.classList.remove('is-active');
        current.classList.remove('is-leaving-right', 'is-leaving-left');
      }
      nextEl.classList.remove('is-entering-right', 'is-entering-left');
    }, SLIDE_MS + 10);

    // 视图进入后的初始化
    if (next === 'rank') refreshRank();
    if (next === 'settings') refreshSettings();
  }

  // ---------- 模式 → 子菜单 ----------
  function openPlay(mode) {
    currentMode = mode || 'classic';
    var cfg = MODE_MAP[currentMode] || MODE_MAP.classic;
    var chip = $('#modeChip');
    if (chip) chip.textContent = cfg.label;
    refreshContinueBtn();
    goView('play', false);
  }

  function refreshContinueBtn() {
    var btn = $('#btnContinue');
    if (!btn) return;
    // 只有经典模式会自动存档(gameState)，其它模式暂不支持续玩
    if (currentMode === 'classic' && hasSave()) {
      btn.classList.remove('is-disabled');
    } else {
      btn.classList.add('is-disabled');
    }
  }

  // 清除经典模式的存档（新游戏 / 覆盖确认用）
  function clearSave() {
    lsRemove(SAVE_KEY);      // 经典存档
    lsRemove('game_save');   // 旧键，兜底清理
  }

  // ---------- 跳转游戏 ----------
  function goGame() {
    var cfg = MODE_MAP[currentMode] || MODE_MAP.classic;
    location.href = cfg.url;
  }

  // ---------- 新游戏 ----------
  function startNewGame() {
    if (hasSave() && currentMode === 'classic') {
      openConfirm();
    } else {
      // 清除存档防止意外残留，然后跳转（真正开始一局新的）
      clearSave();
      goGame();
    }
  }

  function continueGame() {
    if (!hasSave()) return;
    goGame();
  }

  // ---------- 排行榜 ----------
  function refreshRank() {
    var classic = parseInt(lsGet(BEST_KEY) || '0', 10) || 0;
    var daily   = parseInt(lsGet(dailyKey()) || '0', 10) || 0;
    var elC = $('#rankClassic');
    var elD = $('#rankDaily');
    if (elC) elC.textContent = classic;
    if (elD) elD.textContent = daily;
  }

  function resetRecords() {
    if (!confirm('确定要清空排行榜记录吗？')) return;
    lsRemove(BEST_KEY);
    try {
      // 清掉历史每日纪录
      var d = new Date();
      lsRemove('2048-daily-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate());
    } catch (e) {}
    refreshRank();
  }

  // ---------- 设置 ----------
  function soundEnabled() {
    return lsGet(SOUND_KEY) !== '0';
  }
  function refreshSettings() {
    var seg = $('#segSound');
    if (!seg) return;
    var on = soundEnabled();
    var btns = $$('.seg-btn', seg);
    btns.forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-sound') === (on ? '1' : '0'));
    });
  }
  function bindSound() {
    var seg = $('#segSound');
    if (!seg) return;
    $$('.seg-btn', seg).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-sound') === '1';
        lsSet(SOUND_KEY, v ? '1' : '0');
        if (window.Sound) {
          window.Sound.setEnabled(v);
          if (v) window.Sound.tap();
        }
        refreshSettings();
      });
    });
  }

  function clearAllSaves() {
    if (!confirm('确定要清除游戏存档吗？')) return;
    clearSave();
    lsRemove(BEST_KEY);
  }

  // ---------- 确认框 ----------
  function openConfirm() {
    var m = $('#confirmModal');
    if (!m) return;
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
  }
  function closeConfirm() {
    var m = $('#confirmModal');
    if (!m) return;
    m.classList.remove('is-open');
    m.setAttribute('aria-hidden', 'true');
  }

  // ---------- 涟漪 ----------
  function createRipple(ev) {
    var btn = ev.currentTarget;
    if (btn.classList.contains('is-disabled')) return;
    var rect = btn.getBoundingClientRect();
    var x = (ev.clientX !== undefined) ? ev.clientX - rect.left : rect.width  / 2;
    var y = (ev.clientY !== undefined) ? ev.clientY - rect.top  : rect.height / 2;
    var size = Math.max(rect.width, rect.height) * 1.1;
    var r = document.createElement('span');
    r.className = 'ripple';
    r.style.width  = size + 'px';
    r.style.height = size + 'px';
    r.style.left = (x - size / 2) + 'px';
    r.style.top  = (y - size / 2) + 'px';
    btn.appendChild(r);
    setTimeout(function () { r.remove(); }, 620);
  }

  // ---------- 键盘导航（PC 友好） ----------
  function focusButtons(viewEl) {
    var stack = viewEl ? viewEl.querySelector('.btn-stack') : null;
    return stack ? $$('.btn-3d', stack).filter(function (b) { return !b.classList.contains('is-disabled'); }) : [];
  }

  function moveFocus(dir) {
    var cur = $('.view.is-active');
    var btns = focusButtons(cur);
    if (!btns.length) return;
    var idx = btns.indexOf(document.activeElement);
    var next = idx === -1 ? (dir > 0 ? 0 : btns.length - 1) : (idx + dir + btns.length) % btns.length;
    btns[next].focus();
  }

  function onKeydown(e) {
    // ESC：关闭弹窗或返回上一级
    if (e.key === 'Escape') {
      var modal = $('#confirmModal');
      if (modal && modal.classList.contains('is-open')) { closeConfirm(); return; }
      var cur = $('.view.is-active');
      if (!cur) return;
      var name = cur.getAttribute('data-view');
      if (name === 'play')  { goView('modes', true); }
      else if (name === 'modes' || name === 'rank' || name === 'settings') { goView('home', true); }
      return;
    }

    // 方向键导航
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      var active = $('.view.is-active');
      if (active) { e.preventDefault(); moveFocus(e.key === 'ArrowDown' ? 1 : -1); }
      return;
    }

    // 模式视图：数字键直选 1-7
    if (/^[1-7]$/.test(e.key)) {
      var mv = $('.view[data-view="modes"]');
      if (mv && mv.classList.contains('is-active')) {
        var keys = ['classic', 'gravity', 'hex', 'ai', 'quantum', 'dive', 'fib'];
        openPlay(keys[parseInt(e.key, 10) - 1]);
        e.preventDefault();
      }
    }
  }

  // ---------- 事件绑定 ----------
  function bind() {
    // 前进导航：data-go / data-play
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      while (t && t !== document) {
        var go = t.getAttribute && t.getAttribute('data-go');
        if (go === 'modes')  { goView('modes', false); return; }
        if (go === 'home')   { goView('home',  false); return; }
        if (go === 'rank')   { goView('rank', false); return; }
        if (go === 'settings') { goView('settings', false); return; }

        var play = t.getAttribute && t.getAttribute('data-play');
        if (play && MODE_MAP[play]) { openPlay(play); return; }

        var back = t.getAttribute && t.getAttribute('data-back');
        if (back) { goView(back, true); return; }

        var cc = t.getAttribute && t.getAttribute('data-close-confirm');
        if (cc !== null && cc !== undefined) { closeConfirm(); return; }

        t = t.parentNode;
      }
    });

    // 子菜单按钮
    var btnNew = $('#btnNewGame');
    var btnCont = $('#btnContinue');
    if (btnNew)  btnNew.addEventListener('click', startNewGame);
    if (btnCont) btnCont.addEventListener('click', continueGame);

    // 确认 OK
    var cok = $('#confirmOk');
    if (cok) cok.addEventListener('click', function () {
      closeConfirm();
      clearSave();
      goGame();
    });

    // 排行榜
    var btnReset = $('#btnReset');
    if (btnReset) btnReset.addEventListener('click', resetRecords);

    // 设置
    bindSound();
    var btnClear = $('#btnClearSave');
    if (btnClear) btnClear.addEventListener('click', clearAllSaves);

    // 所有 data-ripple 元素挂涟漪
    $$('[data-ripple]').forEach(function (el) {
      el.addEventListener('pointerdown', createRipple);
    });

    // 键盘导航
    document.addEventListener('keydown', onKeydown);
  }

  // ---------- 启动 ----------
  function boot() {
    bind();
    // 首次进入，若有存档，刷新继续按钮
    refreshContinueBtn();
    refreshSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
