/* =============================================================
   bindSwipe — 轻量的滑动检测工具
   传入一个元素与该元素要监听的回调；手势按“右/左/下/上”
   分别回调 1 / 3 / 2 / 0（与 2048 的方向编号一致）。
   ============================================================= */
(function () {
  "use strict";

  function bindSwipe(el, onSwipe) {
    if (!el) return;
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
      if (Math.max(adx, ady) < 12) return;
      // right:1 / left:3 / down:2 / up:0
      onSwipe(adx >= ady ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    }, { passive: true });
  }

  window.bindSwipe = bindSwipe;
})();