/* =============================================================
   2048 肉鸽 · 首页 SPA 路由
   - 三视图切换（home / modes / play），带滑入滑出
   - 涟漪、确认框、game_save 存档检查
   ============================================================= */
(function () {
  'use strict';

  // ---------- 常量 ----------
  var SLIDE_MS = 300;
  // 经典模式真正的存档键（对应 classic 页面 LocalStorageManager 的 gameState）
  var SAVE_KEY = 'gameState';
  var MODE_MAP = {
    classic: { label: '经典模式', url: 'game.html' },
    gravity: { label: '星落模式', url: 'game_gravity.html' },
    hex:     { label: '六边模式', url: 'game_hex.html' },
    ai:      { label: '对抗模式', url: 'game_ai.html' }
  };

  // ---------- 状态 ----------
  var currentMode = 'classic';

  // ---------- 工具 ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function hasSave() {
    try {
      var v = localStorage.getItem(SAVE_KEY);
      return v !== null && v !== undefined && v !== '';
    } catch (e) {
      return false;
    }
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
    try {
      localStorage.removeItem('gameState');      // 经典存档
      localStorage.removeItem('game_save');      // 旧键，兜底清理
      localStorage.removeItem('bestScore');
    } catch (e) {}
  }

  // ---------- 跳转游戏 ----------
  function goGame() {
    var cfg = MODE_MAP[currentMode] || MODE_MAP.classic;
    var url = cfg.url;
    // 加时间戳避免缓存（可选）
    location.href = url;
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

  // ---------- 事件绑定 ----------
  function bind() {
    // 前进导航：data-go / data-play
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      while (t && t !== document) {
        var go = t.getAttribute && t.getAttribute('data-go');
        if (go === 'modes')  { goView('modes', false); return; }
        if (go === 'home')   { goView('home',  false); return; }
        if (go === 'quit')   { onQuit(); return; }
        if (go === 'settings') { alert('设置功能即将开放，敬请期待~'); return; }

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

    // 所有 data-ripple 元素挂涟漪
    $$('[data-ripple]').forEach(function (el) {
      el.addEventListener('pointerdown', createRipple);
    });

    // 键盘：ESC 返回上一级
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var modal = $('#confirmModal');
      if (modal && modal.classList.contains('is-open')) { closeConfirm(); return; }
      var cur = $('.view.is-active');
      if (!cur) return;
      var name = cur.getAttribute('data-view');
      if (name === 'play')  { goView('modes', true); }
      else if (name === 'modes') { goView('home',  true); }
    });
  }

  function onQuit() {
    if (confirm('确定要退出游戏吗？')) {
      // 浏览器无法真正"退出"，回到空白页
      try { window.close(); } catch (e) {}
      setTimeout(function () { document.body.innerHTML = '<div style="color:#999;text-align:center;padding:40vh 0;font-family:sans-serif">感谢游玩 2048＋ ✦</div>'; }, 50);
    }
  }

  // ---------- 启动 ----------
  function boot() {
    bind();
    // 首次进入，若有存档，刷新继续按钮
    refreshContinueBtn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
