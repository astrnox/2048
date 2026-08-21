/* =============================================================
   assist.js · 全站"难度 / 援助"系统（默认关闭）
   开启后，后台会即时推算当前局面"最需要的方块值 + 应出现的位置"，
   按所选难度调整援助力度：简单=最强辅助，困难=最弱（接近原生随机）。
   全部算法均只扫一遍空位（O(空位数)），绝不跑深搜，性能无忧。
   仅用于援助生成落子；玩家自身操作与 AI 对战不受此影响。
   ============================================================= */
(function () {
  "use strict";

  var DEF_KEY = "2048-diff";
  var DEF = "off";

  // [值, 中文标签]：off=关闭(完全随机) easy=简单 med=中等 hard=困难
  var ORDER = [["off", "关闭"], ["easy", "简单"], ["med", "中等"], ["hard", "困难"]];

  // 各档位的"援助强度" 0..1(1=最照顾玩家)
  function strength(v) {
    return { easy: 1, med: 0.55, hard: 0.15 }[v] || 0;
  }

  function get(key) { key = key || DEF_KEY; try { return localStorage.getItem(key) || DEF; } catch (e) { return DEF; } }
  function set(key, v) { key = key || DEF_KEY; try { localStorage.setItem(key, v); } catch (e) {} }

  /* ---------- 二维方阵(经典/星落/生长)的空位打分 ---------- */
  function score2D(board, rows, cols, r, c) {
    var s = 0;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) s += 10; // 靠边不挤中间
    var empties = 0, small = 0, big = 0;
    for (var i = 0; i < dirs.length; i++) {
      var nr = r + dirs[i][0], nc = c + dirs[i][1];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) { s += 4; continue; }
      var nv = board[nr][nc];
      if (nv === 0) empties++;
      else if (nv < 8) small++;
      else big++;
    }
    s += empties * 6 + small * 2 - big;
    return s;
  }

  // 从二维棋盘挑一个空位；strength 越高越偏向"最佳格"
  function pick4(board, strengthS) {
    var rows = board.length, cols = board[0].length;
    var cells = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (!board[r][c]) cells.push({ r: r, c: c, s: score2D(board, rows, cols, r, c) });
    }
    if (!cells.length) return null;
    cells.sort(function (a, b) { return b.s - a.s; });
    var k = Math.max(1, Math.round(cells.length * (1 - strengthS)));
    k = Math.min(k, cells.length);
    return cells[Math.floor(Math.random() * k)];
  }

  /* ---------- 六边形(轴向)空位打分 ---------- */
  var DIRS6 = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  function scoreHex(boardObj, keyFn, q, r) {
    var s = 0, empties = 0, small = 0;
    for (var i = 0; i < DIRS6.length; i++) {
      var k = keyFn(q + DIRS6[i][0], r + DIRS6[i][1]);
      if (k in boardObj) {
        var v = boardObj[k];
        if (v === 0) empties++;
        else if (v < 8) small++;
      } else s += 4; // 场外（合法方向）也算"较松弛"
    }
    s += empties * 5 + small * 2;
    return s;
  }
  function pickHex(boardObj, empties /* [{q,r}] */, strengthS, keyFn) {
    if (!empties.length) return null;
    var scored = empties.map(function (c) { return { q: c.q, r: c.r, s: scoreHex(boardObj, keyFn, c.q, c.r) }; });
    scored.sort(function (a, b) { return b.s - a.s; });
    var k = Math.max(1, Math.round(scored.length * (1 - strengthS)));
    k = Math.min(k, scored.length);
    return scored[Math.floor(Math.random() * k)] || null;
  }

  // 援助时新块的取值：强辅助几乎总是给 2（最易合体）；越弱越贴近原生 10% 给 4
  function pickValue(strengthS) {
    return Math.random() < (0.1 * (1 - strengthS)) ? 4 : 2;
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

    var wrap = document.createElement("div");
    wrap.className = "diff";
    var lab = document.createElement("span");
    lab.className = "diff-label";
    lab.textContent = opts.label || "难度 / 援助";
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
    return { easy: 2, med: 4, hard: 6 }[diff] || 4;
  }

  window.Assist = {
    ORDER: ORDER,
    strength: strength,
    get: get,
    set: set,
    pick4: pick4,
    pickHex: pickHex,
    pickValue: pickValue,
    score2D: score2D,
    scoreHex: scoreHex,
    botDepth: botDepth,
    mount: mount
  };
})();