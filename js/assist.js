/* =============================================================
   assist.js · 难度系统（数值生成）
   难度只用「新块取值分布」这一个可解释、可量化的旋钮来控制：
     - easy   几乎只出 2        （2:98%  4:2%  8:0）
     - normal 经典原生规则       （2:90%  4:10% 8:0）
     - hard   高压               （2:57%  4:35% 8:8）
   不再对棋盘格子打分、不猜"该往哪放"——落点一律均匀随机，
   公平且可复现，难度完全由出牌价值决定。
   历史的 'off/med' 键自动映射到等价档位（off→normal, med→normal）。
   ============================================================= */
(function () {
  "use strict";

  var DEF_KEY = "2048-diff";
  var DEF = "normal";

  var ORDER = [["easy", "简单"], ["normal", "普通"], ["hard", "困难"]];

  // 各档位出牌分布（新块取值概率，单位：出现即可）p8 先于 p4 判
  var TABLE = {
    easy:   { p8: 0,    p4: 0.02 },
    normal: { p8: 0,    p4: 0.10 },
    hard:   { p8: 0.08, p4: 0.35 }
  };

  // 兼容旧存档：off/med 并入等价档位
  var MIGRATE = { off: "normal", med: "normal", easy: "easy", normal: "normal", hard: "hard" };

  function get(key) {
    key = key || DEF_KEY;
    try {
      var raw = localStorage.getItem(key) || DEF;
      return MIGRATE[raw] || DEF;
    } catch (e) { return DEF; }
  }
  function set(key, v) { key = key || DEF_KEY; try { localStorage.setItem(key, v); } catch (e) {} }

  /* ---------- 科学家最爱的旋钮：新块取值 ---------- */
  function spawnValue(diff) {
    var d = TABLE[MIGRATE[diff] || diff] || TABLE.normal;
    var r = Math.random();
    if (r < d.p8) return 8;
    if (r < d.p8 + d.p4) return 4;
    return 2;
  }

  /* ---------- 落点：一律均匀随机，不做任何偏向 ---------- */
  function randCell(cells) {
    return cells[Math.floor(Math.random() * cells.length)] || null;
  }
  // 兼容旧调用：二维数组空位列表 rows×cols → 均匀随机
  function pick4(board, strengthS) {
    var rows = board.length, cols = board[0].length, cells = [], r, c;
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) if (!board[r][c]) cells.push({ r: r, c: c });
    return randCell(cells);
  }
  function pickHex(boardObj, empties, strengthS, keyFn) {
    return randCell(empties);
  }

  // 保留旧 value 兼容（强度档位 → 一个 0..1 的数），AI 深度映射用
  function strength(v) {
    return { easy: 1, normal: 0.55, hard: 0.15 }[MIGRATE[v] || v] || 0.55;
  }
  function pickValue(strengthS) {
    var v = get();
    return spawnValue(v);
  }

  /* ---------- UI：分段式选择器 ---------- */
  function mount(slotId, opts) {
    var slot = document.getElementById(slotId);
    if (!slot) return null;
    opts = opts || {};
    var key = opts.key || DEF_KEY;
    var options = opts.options || ORDER;
    var cur = get(key);
    if (!options.some(function (o) { return o[0] === cur; })) cur = (opts.def || DEF);
    if (cur === "normal" && !options.some(function (o) { return o[0] === "normal"; })) cur = options[0][0];

    var wrap = document.createElement("div");
    wrap.className = "diff";
    var lab = document.createElement("span");
    lab.className = "diff-label";
    lab.textContent = opts.label || "难度";
    wrap.appendChild(lab);

    options.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "diff-btn" + (o[0] === cur ? " on" : "");
      b.textContent = o[1];
      b.setAttribute("data-v", o[0]);
      b.addEventListener("click", function () {
        cur = o[0];
        set(key, cur);
        var arr = wrap.querySelectorAll(".diff-btn");
        for (var i = 0; i < arr.length; i++) arr[i].classList.toggle("on", arr[i].getAttribute("data-v") === cur);
        if (opts.onchange) opts.onchange(cur);
      });
      wrap.appendChild(b);
    });
    slot.appendChild(wrap);
    return { value: function () { return cur; } };
  }

  /* ---------- AI 对战：bot 深度随难度增减 ---------- */
  function botDepth(diff) {
    return { easy: 2, normal: 4, hard: 6 }[MIGRATE[diff] || diff] || 4;
  }

  window.Assist = {
    ORDER: ORDER,
    spawnValue: spawnValue,
    strength: strength,
    get: get,
    set: set,
    pick4: pick4,
    pickHex: pickHex,
    pickValue: pickValue,
    botDepth: botDepth,
    mount: mount
  };
})();