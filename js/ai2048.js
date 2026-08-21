/* =============================================================
   AI 对抗模式 · 人机双棋盘竞速
   你在左、机器人在右，同一规则各自的棋盘上比快——
   谁先合成 2048 谁赢；若双方都卡死则比得分。
   ============================================================= */
(function () {
  "use strict";

  var WIN_VAL = 2048;
  var BOT_INTERVAL = 500; // ms，机器人每步思考节奏

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
  // Returns { board, gained, moved } (board is a fresh copy).
  function tryMove(board, dir) {
    var b = clone(board);
    var gained = 0;
    var moved = false;

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
      // write back
      for (var j = 0; j < 4; j++) {
        var rr2 = axis === 0 ? lane : (forward === 1 ? j : 3 - j);
        var cc2 = axis === 0 ? (forward === 1 ? j : 3 - j) : lane;
        b[rr2][cc2] = res.line[j];
      }
    }

    return { board: b, gained: gained, moved: moved };
  }

  // Slide a 4-lane left (existing values first), merge equals once.
  function slideMerge(vals) {
    var nz = vals.filter(function (v) { return v !== 0; });
    var out = [];
    var moved = nz.length !== vals.length;
    var gained = 0;
    for (var i = 0; i < nz.length; i++) {
      if (i + 1 < nz.length && nz[i] === nz[i + 1]) {
        out.push(nz[i] * 2);
        gained += nz[i] * 2;
        i++; // consume next
        moved = true;
      } else {
        out.push(nz[i]);
      }
    }
    while (out.length < 4) out.push(0);
    // compare to original to detect if moved (merge already flagged)
    return { line: out, gained: gained, moved: moved };
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

  /* ---- Bot heuristic ----
     Empty cells are king; reward merges, cap sum-of-rows disorder
     and hug the corner with a big tile. Weighted so the bot is
     competent but a quick human can out-race it. */
  function evaluate(board, gained) {
    var score = gained * 3;
    score += emptyCells(board).length * 70;

    var merges = 0;
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++) {
        var v = board[r][c];
        if (!v) continue;
        if (c + 1 < 4 && board[r][c + 1] === v) merges++;
        if (r + 1 < 4 && board[r + 1][c] === v) merges++;
      }
    score += merges * 110;

    // monotonicity: penalty for big-then-small ordering changes
    var mono = 0;
    for (var r2 = 0; r2 < 4; r2++) {
      for (var dir = 0; dir < 2; dir++) {
        var prev = 0, first = true;
        for (var c2 = 0; c2 < 4; c2++) {
          var v = board[r2][dir ? c2 : 3 - c2];
          if (v === 0) continue;
          if (!first && v > prev) mono += v - prev;
          prev = v; first = false;
        }
      }
    }
    for (var c3 = 0; c3 < 4; c3++) {
      for (var dir2 = 0; dir2 < 2; dir2++) {
        var prev2 = 0, first2 = true;
        for (var r3 = 0; r3 < 4; r3++) {
          var v2 = board[r3][c3];
          if (v2 === 0) continue;
          if (!first2 && v2 > prev2) mono += v2 - prev2;
          prev2 = v2; first2 = false;
        }
      }
    }
    score -= mono * 6;

    score += maxVal(board) * 2;
    return score;
  }

  function bestMove(board) {
    var best = null, bestScore = -Infinity;
    for (var d = 0; d < 4; d++) {
      var res = tryMove(board, d);
      if (!res.moved) continue;
      var s = evaluate(res.board, res.gained);
      if (s > bestScore) { bestScore = s; best = d; }
    }
    return best;
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
    this.botTimer = null;

    this.el = {
      pBoard: document.getElementById("board-p"),
      bBoard: document.getElementById("board-b"),
      pScore: document.getElementById("score-p"),
      bScore: document.getElementById("score-b"),
      pMerges: document.getElementById("merges-p"),
      bMerges: document.getElementById("merges-b"),
      timer: document.getElementById("race-timer"),
      banner: document.getElementById("banner"),
      bannerText: document.getElementById("banner-text")
    };
    this.pMerge = 0; this.bMerge = 0;

    this.newRound();
  }

  Duel.prototype.newRound = function () {
    var self = this;
    this.round++;
    this.p = emptyBoard(); this.ps = 0; this.pMerge = 0;
    this.b = emptyBoard(); this.bs = 0; this.bMerge = 0;
    this.winner = null;

    spawn(this.p); spawn(this.p); spawn(this.p);
    spawn(this.b); spawn(this.b); spawn(this.b);

    this.t0 = Date.now();
    this.el.banner.style.display = "none";

    if (this.botTimer) window.clearInterval(this.botTimer);
    this.botTimer = window.setInterval(function () { self.botTick(); }, BOT_INTERVAL);

    this.render();
  };

  Duel.prototype.botTick = function () {
    if (this.winner) return;
    var d = bestMove(this.b);
    if (d === null) { this.resolve(); this.render(); return; }
    var res = tryMove(this.b, d);
    this.bs += res.gained;
    this.b = res.board;
    this.bMerge += res.gained;
    spawn(this.b);
    this.checkWin();
    this.render();
  };

  Duel.prototype.playerMove = function (dir) {
    if (this.winner) return;
    var res = tryMove(this.p, dir);
    if (!res.moved) return;
    this.p = res.board;
    this.ps += res.gained;
    this.pMerge += res.gained;
    spawn(this.p);
    this.checkWin();
    this.render();
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
    if (this.winner === "p") this.el.bannerText.textContent = "🎉 你赢啦！抢先合成 2048";
    else if (this.winner === "b") this.el.bannerText.textContent = "🤖 机器人赢了，再来一局？";
    else this.el.bannerText.textContent = "🤝 平局！势均力敌";
  };

  Duel.prototype.render = function () {
    this.el.pScore.textContent = this.ps;
    this.el.bScore.textContent = this.bs;
    this.el.pMerges.textContent = "+" + this.pMerge;
    this.el.bMerges.textContent = "+" + this.bMerge;
    var secs = Math.floor((Date.now() - this.t0) / 1000);
    this.el.timer.textContent = Math.floor(secs / 60) + ":" + ("0" + (secs % 60)).slice(-2);

    renderBoard(this.el.pBoard, this.p);
    renderBoard(this.el.bBoard, this.b);
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