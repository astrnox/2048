/* =============================================================
   sfx.js · 极简 WebAudio 音效
   - drop()  方块下落的解压闷响
   - merge() 合体的“戳果冻”弹响
   开关存 localStorage('2048-sound'，默认开)。无音频文件，纯合成。
   ============================================================= */
(function () {
  "use strict";

  var KEY = "2048-sound";
  var enabled = true;
  try { enabled = localStorage.getItem(KEY) !== "0"; } catch (e) {}

  var ctx = null;
  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // 一次性解锁（浏览器自动播放策略）
  function unlock() {
    var c = ensure();
    if (c) { try { if (c.state === "suspended") c.resume(); } catch (e) {} }
  }
  [["pointerdown", unlock], ["pointerup", unlock], ["keydown", unlock], ["touchstart", unlock]]
    .forEach(function (p) { window.addEventListener(p[0], p[1], { passive: true, once: true }); });

  // 单个音：频率滑音 + 轻微指数衰减
  function pluck(f0, f1, dur, vol, type) {
    var c = ensure();
    if (!c) return;
    var t = c.currentTime;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  var Sound = {
    // 下落：低沉“咚”，带轻微挤压感
    drop: function () {
      if (!enabled || !ctx) return;
      pluck(160, 70, 0.16, 0.35, "sine");
      pluck(420, 180, 0.07, 0.12, "triangle");
    },
    // 合体：果冻“啵啾”，清脆上翘，像戳果冻
    merge: function () {
      if (!enabled || !ctx) return;
      pluck(520, 820, 0.12, 0.28, "sine");
      pluck(1040, 460, 0.16, 0.14, "sine");
    },
    // 设置里点开关时的试听小音
    tap: function () {
      if (!enabled || !ctx) return;
      pluck(700, 1200, 0.09, 0.2, "sine");
    },
    setEnabled: function (v) {
      enabled = !!v;
      try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch (e) {}
    },
    getEnabled: function () { return enabled; },
    // 供设置面板首帧解锁
    unlock: unlock,
    // 设置（音效开关）挂载到某个槽位，复用 .diff 分段式按钮样式
    mount: function (slotId, opts) {
      var slot = document.getElementById(slotId);
      if (!slot) return null;
      opts = opts || {};
      var wrap = document.createElement("div");
      wrap.className = "diff";
      var lab = document.createElement("span");
      lab.className = "diff-label";
      lab.textContent = opts.label || "音效";
      wrap.appendChild(lab);
      var on = document.createElement("button");
      on.type = "button"; on.className = "diff-btn" + (enabled ? " on" : ""); on.textContent = "开";
      var off = document.createElement("button");
      off.type = "button"; off.className = "diff-btn" + (!enabled ? " on" : ""); off.textContent = "关";
      function sync() { on.classList.toggle("on", enabled); off.classList.toggle("on", !enabled); }
      on.addEventListener("click", function () { setEnabled(true); Sound.tap(); sync(); });
      off.addEventListener("click", function () { setEnabled(false); sync(); });
      wrap.appendChild(on); wrap.appendChild(off);
      slot.appendChild(wrap);
      return {
        sync: sync,
        value: function () { return enabled; }
      };
    }
  };

  window.Sound = Sound;
})();