/* =============================================================
   swipe.js · 触摸滑动与滑动反馈工具
   - bindSwipe    4 向手势（右/左/下/上 → 1/3/2/0）
   - bindSwipe8   8 向手势（含对角线，用于六边形网格）
   - nudge        给棋盘容器一个轻快的“推力”微动画，让滑动跟手
   ============================================================= */
(function () {
  "use strict";

  function gesture(el, onSwipe) {
    if (!el) return {};
    var startX = 0, startY = 0, started = false;

    el.addEventListener("touchstart", function (e) {
      if (e.touches.length > 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      started = true;
    }, { passive: true });

    el.addEventListener("touchend", function (e) {
      if (!started || e.changedTouches.length < 1) { started = false; return; }
      started = false;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) < 14) return;
      onSwipe({ dx: dx, dy: dy, adx: adx, ady: ady });
    }, { passive: true });

    return { attach: function (elm) { el = elm; }, detach: function () {} };
  }

  // 四向：右/左/下/上 → 1/3/2/0
  function bindSwipe(el, onSwipe) {
    gesture(el, function (g) {
      onSwipe(g.adx >= g.ady ? (g.dx > 0 ? 1 : 3) : (g.dy > 0 ? 2 : 0));
    });
  }

  // 八向：右=1 下=2 左=3 上=0 右下=5 左下=6 左上=7 右上=4
  function bindSwipe8(el, onSwipe) {
    gesture(el, function (g) {
      var horiz = g.adx >= g.ady * 0.5;   // 横偏明显
      var vert = g.ady >= g.adx * 0.5;    // 纵偏明显
      var sx = g.dx > 0 ? 1 : -1, sy = g.dy > 0 ? 1 : -1;
      var code;
      if (horiz && vert) {
        // 对角
        code = (sx > 0 && sy > 0) ? 5 : (sx > 0 && sy < 0) ? 4 : (sx < 0 && sy > 0) ? 6 : 7;
      } else if (horiz) {
        code = sx > 0 ? 1 : 3;
      } else {
        code = sy > 0 ? 2 : 0;
      }
      onSwipe(code);
    });
  }

  // 给元素一个方向性的“推力”动画（配合各模式的 @keyframes nu0..nu3）
  function nudge(el, dir) {
    if (!el) return;
    var cls = ["nu0", "nu1", "nu2", "nu3"][dir]; // 上/右/下/左
    el.classList.remove("nu0", "nu1", "nu2", "nu3");
    void el.offsetWidth; // reflow 使动画重放
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 320);
  }

  window.bindSwipe = bindSwipe;
  window.bindSwipe8 = bindSwipe8;
  window.nudge = nudge;
})();