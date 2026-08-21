/* =============================================================
   AI 对抗模式 · 人机双棋盘竞速
   你在左、机器人在右，同一规则各自的棋盘上比快——
   谁先合成 2048 谁赢；若双方都卡死则比得分。
   ============================================================= */
(function () {
  "use strict";

  var WIN_VAL = 2048;
  var DIRS4 = [0, 1, 2, 3]; // up / right / down / left

  function emptyBoard() {
    var b = [];
    for (var i = 0; i < 4; i++) b.push([0, 0, 0, 0]);
    return b;
  }

  function clone(b) { return b.map(function (r) { return r.slice(); }); }

  function emptyCells(b) {
    var out = [];
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++)
        if (b[r][c] === 0) out.push([r, c]);
    return out;
  }

  function spawn(b) {
    var cells = emptyCells(b);
    if (!cells.length) return false;
    var p = cells[Math.floor(Math.random() * cells.length)];
    b[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    return true;
  }

  // Move board towards dir. dir: 0 up,1 right,2 down,3 left.
  // Returns { board, gained, moved, merges } (board is a fresh copy).
  function tryMove(board, dir) {
    var b = clone(board);
    var gained = 0;
    var moved = false;
    var merges = 0;

    var line = function (r, c, axis) { return axis === 0 ? r : c; };

    // Build traverse order based on dir axis/value.
    // axis=1 slides along a column, axis=0 along a row.
    var axis = (dir === 0 || dir === 2) ? 1 : 0;
    // forward=+1 merges toward top/left (index 0); -1 toward bottom/right (index 3).
    var forward = (dir === 1 || dir === 2) ? -1 : 1;

    // Represent each "lane" as an array in travel direction, process, write back.
    for (var lane = 0; lane < 4; lane++) {
      // extract lane (merge target ends up at index 0)
      var vals = [];
      for (var i = 0; i < 4; i++) {
        var rr = axis === 0 ? lane : (forward === 1 ? i : 3 - i);
        var cc = axis === 0 ? (forward === 1 ? i : 3 - i) : lane;
        vals.push(b[rr][cc]);
      }
      // slide + merge toward index 0 of vals
      var res = slideMerge(vals);
      if (res.moved) moved = true;
      gained += res.gained;
      merges += res.merges;
      // write back
      for (var j = 0; j < 4; j++) {
        var rr2 = axis === 0 ? lane : (forward === 1 ? j : 3 - j);
        var cc2 = axis === 0 ? (forward === 1 ? j : 3 - j) : lane;
        b[rr2][cc2] = res.line[j];
      }
    }

    return { board: b, gained: gained, moved: moved, merges: merges };
  }

  // Slide a 4-lane left (existing values first), merge equals once.
  function slideMerge(vals) {
    var nz = vals.filter(function (v) { return v !== 0; });
    var out = [];
    var moved = nz.length !== vals.length;
    var gained = 0;
    var merges = 0;
    for (var i = 0; i < nz.length; i++) {
      if (i + 1 < nz.length && nz[i] === nz[i + 1]) {
        out.push(nz[i] * 2);
        gained += nz[i] * 2;
        merges++;
        i++; // consume next
        moved = true;
      } else {
        out.push(nz[i]);
      }
    }
    while (out.length < 4) out.push(0);
    // compare to original to detect if moved (merge already flagged)
    return { line: out, gained: gained, moved: moved, merges: merges };
  }

  function maxVal(b) {
    var m = 0;
    forEach(b, function (v) { if (v > m) m = v; });
    return m;
  }
  function forEach(b, fn) {
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) fn(b[r][c], r, c);
  }

  function deadOr(b) {
    if (emptyCells(b).length) return false;
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++) {
        var v = b[r][c];
        if (c + 1 < 4 && b[r][c + 1] === v) return false;
        if (r + 1 < 4 && b[r + 1][c] === v) return false;
      }
    return true;
  }

  /* ---- Bot: Expectimax (2048-style) ----
     AI 在反"随便滑动必输"的意义上要够硬：走一步前把所有可能局面
     （自己的走法 + 对手随机放 2/4）往前推几层，用蛇形角位权重打分，
     让大数始终压向角落、留空位，从而稳定合成 2048。 */
  // 蛇形权重：大数越靠近左上角分越高
  var W = [
    [16, 15, 14, 13],
    [ 9,  8,  7, 12],
    [ 5,  4,  6, 11],
    [ 1,  2,  3, 10]
  ];

  function heuristic(board) {
    var s = 0, empty = 0;
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var v = board[r][c];
      if (!v) { empty++; continue; }
      s += v * W[r][c];
      // 平滑：紧邻数字差距越小越好
      if (c + 1 < 4 && board[r][c + 1]) s -= Math.abs(v - board[r][c + 1]) * 2;
      if (r + 1 < 4 && board[r + 1][c]) s -= Math.abs(v - board[r + 1][c]) * 2;
    }
    s += empty * 260;
    return s;
  }

  // 从空位里随机抽样至多 k 个，作为"对手随机放子"的采样（限制计算量）
  function sampleCells(cells, k) {
    var copy = cells.slice(), res = [];
    while (copy.length && res.length < k) {
      var i = Math.floor(Math.random() * copy.length);
      res.push(copy[i]);
      copy.splice(i, 1);
    }
    return res;
  }

  // 全局节点预算：让每次决策的计算量严格受控，深度再高也不至于卡顿
  var budget = 0;
  var NODE_BUDGETS = { 2: 800, 4: 3200, 6: 16000 }; // 简单/中等/困难

  // chanceNode=true 表示轮到随机放子（对手），false 表示自己挑最好走法
  function expectimax(board, depth, chanceNode) {
    if (depth <= 0 || --budget <= 0) return heuristic(board);
    if (chanceNode) {
      var cells = emptyCells(board);
      if (!cells.length) return (depth <= 1) ? heuristic(board) : -Infinity;
      var samples = sampleCells(cells, Math.min(3, cells.length));
      var total = 0;
      for (var i = 0; i < samples.length; i++) {
        var rc = samples[i];
        var b2 = clone(board); b2[rc[0]][rc[1]] = 2;
        var b4 = clone(board); b4[rc[0]][rc[1]] = 4;
        total += 0.9 * expectimax(b2, depth - 1, false) + 0.1 * expectimax(b4, depth - 1, false);
      }
      return total / samples.length;
    } else {
      var best = -Infinity;
      for (var d = 0; d < 4; d++) {
        var res = tryMove(board, d);
        if (res.moved) best = Math.max(best, expectimax(res.board, depth - 1, true));
      }
      return best === -Infinity ? heuristic(board) : best;
    }
  }

  function bestMove(board, depth) {
    depth = depth || 4;
    budget = NODE_BUDGETS[depth] || 3200;
    var bestDir = null, best = -Infinity;
    for (var d = 0; d < 4; d++) {
      var res = tryMove(board, d);
      if (!res.moved) continue;
      var s = expectimax(res.board, depth, true); // 自己走一步后，推对手随机放子
      if (s > best) { best = s; bestDir = d; }
    }
    return bestDir;
  }

  // ---------------- Rendering ----------------
  var TILE_COLOR = {
    2: "#eee4da", 4: "#ede0c8", 8: "#f2b179", 16: "#f59563",
    32: "#f67c5f", 64: "#f65e3b", 128: "#edcf72", 256: "#edcc61",
    512: "#edc850", 1024: "#edc53f", 2048: "#edc22e",
    4096: "#3c3a32", 8192: "#5bca57"
  };

  function Duel() {
    this.p = emptyBoard(); this.ps = 0;       // player
    this.b = emptyBoard(); this.bs = 0;       // bot
    this.winner = null;
    this.round = 0;
    this.t0 = 0;
    this.aiTimer = null;
    this.thinking = false;

    this.el = {
      pBoard: document.getElementById("board-p"),
      bBoard: document.getElementById("board-b"),
      pScore: document.getElementById("score-p"),
      bScore: document.getElementById("score-b"),
      pMerges: document.getElementById("merges-p"),
      bMerges: document.getElementById("merges-b"),
      timer: document.getElementById("race-timer"),
      banner: document.getElementById("banner"),
      bannerText: document.getElementById("banner-text"),
      aiStatus: document.getElementById("ai-status"),
      combo: document.getElementById("ai-combo")
    };
    this.pMerge = 0; this.bMerge = 0;
    this.pCombo = 0; // 2048+ 你本步连击

    this.newRound();
  }

  Duel.prototype.newRound = function () {
    var self = this;
    this.round++;
    this.p = emptyBoard(); this.ps = 0; this.pMerge = 0; this.pCombo = 0;
    this.b = emptyBoard(); this.bs = 0; this.bMerge = 0;
    this.winner = null;

    if (this.el.combo) this.el.combo.classList.remove("on");

    spawn(this.p); spawn(this.p); spawn(this.p);
    spawn(this.b); spawn(this.b); spawn(this.b);

    this.t0 = Date.now();
    this.el.banner.style.display = "none";
    if (this.aiTimer) window.clearTimeout(this.aiTimer);

    this.setStatus("你的回合");
    this.render();
  };

  // 2048+：你本步多次合并 → 弹连击徽标
  Duel.prototype.flashCombo = function () {
    var c = this.el.combo;
    if (!c) return;
    if (this.pCombo >= 2) {
      c.textContent = "×" + this.pCombo + " 连击";
      c.classList.remove("on");
      void c.offsetWidth;
      c.classList.add("on");
    } else {
      c.classList.remove("on");
    }
  };

  // 你的落子触发机器人：先"思考"，再走一步，然后停下来等你
  Duel.prototype.think = function () {
    var self = this;
    if (this.winner) return;
    this.setStatus("机器人思考中…");
    if (this.aiTimer) window.clearTimeout(this.aiTimer);
    this.aiTimer = window.setTimeout(function () { self.aiAct(); }, 420);
  };

  Duel.prototype.aiAct = function () {
    if (this.winner) return;
    // 难度 → 搜索深度：简单=浅(弱) 中等=标准 困难=深(强)；bot 档位存于 2048-botdiff
    var diff = (window.Assist && window.Assist.get("2048-botdiff")) || "med";
    var depth = window.Assist ? window.Assist.botDepth(diff) : 4;
    var d = bestMove(this.b, depth);
    if (d === null) { this.checkWin(); this.renderB(); this.setStatus(this.winner ? "" : "机器入局停止"); return; }
    var res = tryMove(this.b, d);
    this.bs += res.gained;
    this.b = res.board;
    this.bMerge += res.gained;
    spawn(this.b);
    this.checkWin();
    this.renderB();
    this.setStatus(this.winner ? "" : "你的回合");
  };

  Duel.prototype.setStatus = function (txt) {
    if (this.el.aiStatus) this.el.aiStatus.textContent = txt;
  };

  Duel.prototype.playerMove = function (dir) {
    if (this.winner) return;
    var res = tryMove(this.p, dir);
    if (!res.moved) return;
    this.p = res.board;
    this.ps += res.gained;
    this.pMerge += res.gained;
    this.pCombo = res.merges; // 2048+ 本步连击
    spawn(this.p);
    this.checkWin();
    if (window.nudge) window.nudge(this.el.pBoard, dir); // 滑动跟随的推力
    this.renderP();
    this.flashCombo();
    if (!this.winner) this.think(); // 你动一步 → 机器人想一步
  };

  Duel.prototype.checkWin = function () {
    var p2048 = maxVal(this.p) >= WIN_VAL;
    var b2048 = maxVal(this.b) >= WIN_VAL;
    if (p2048 && b2048) this.winner = "tie";
    else if (p2048) this.winner = "p";
    else if (b2048) this.winner = "b";
    else {
      var pd = deadOr(this.p), bd = deadOr(this.b);
      if (pd && bd) this.winner = this.ps >= this.bs ? "p" : "b";
      else if (pd) { this.winner = "b"; }
      else if (bd) { this.winner = "p"; }
    }
    if (this.winner) this.actuateBanner();
  };

  Duel.prototype.resolve = function () { this.checkWin(); };

  Duel.prototype.actuateBanner = function () {
    this.el.banner.style.display = "flex";
    if (this.winner === "p") this.el.bannerText.textContent = "你赢了 · 抢先合成 2048";
    else if (this.winner === "b") this.el.bannerText.textContent = "机器人赢了 · 再战一局？";
    else this.el.bannerText.textContent = "平局 · 势均力敌";
  };

  Duel.prototype.render = function () {
    this.renderStats();
    renderBoard(this.el.pBoard, this.p);
    renderBoard(this.el.bBoard, this.b);
  };
  Duel.prototype.renderP = function () { this.renderStats(); renderBoard(this.el.pBoard, this.p); };
  Duel.prototype.renderB = function () { this.renderStats(); renderBoard(this.el.bBoard, this.b); };
  Duel.prototype.renderStats = function () {
    this.el.pScore.textContent = this.ps;
    this.el.bScore.textContent = this.bs;
    this.el.pMerges.textContent = "+" + this.pMerge;
    this.el.bMerges.textContent = "+" + this.bMerge;
    var secs = Math.floor((Date.now() - this.t0) / 1000);
    this.el.timer.textContent = Math.floor(secs / 60) + ":" + ("0" + (secs % 60)).slice(-2);
  };

  function renderBoard(container, board) {
    container.innerHTML = "";
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        var cell = document.createElement("div");
        cell.className = "cell";
        var v = board[r][c];
        if (v) {
          cell.className += " has-tile";
          cell.style.background = TILE_COLOR[v] || "#3c3a32";
          cell.style.color = (v === 2 || v === 4) ? "#776e65" : "#f9f6f2";
          cell.textContent = v;
          var fs = v < 100 ? 26 : (v < 1000 ? 22 : (v < 10000 ? 15 : 12));
          cell.style.fontSize = fs + "px";
        }
        container.appendChild(cell);
      }
    }
  }

  // ---------------- input ----------------
  var KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };

  window.AiDuel = function () {
    var game = new Duel();
    window.addEventListener("keydown", function (e) {
      var d = KEYS[e.code];
      if (d === undefined) return;
      e.preventDefault();
      game.playerMove(d);
    });
    // 手机滑动：在己方棋盘上滑动控制左边的棋盘
    if (window.bindSwipe) window.bindSwipe(document.getElementById("board-p"), function (d) { game.playerMove(d); });
    document.getElementById("replay").addEventListener("click", function () { game.newRound(); });
    return game;
  };
})();