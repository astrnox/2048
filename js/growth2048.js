/* =============================================================
   万物生长 · “生长中的棋盘”
   不用随机落子，而是让棋盘自己活过来：每次移动后，
   空位会长出一粒种子(2)，种子下一回合成熟为 4。
   若你不合体，季节会催促——久不凋零合体，便额外发芽。
   合成 2048 即抵达深秋的硕果。
   ============================================================= */
(function () {
  "use strict";

  var WIN_VAL = 2048;
  var STALL_SPROUT = 4; // 连续不合体 N 步，春天额外发芽一次

  function emptyBoard() {
    var b = [];
    for (var i = 0; i < 4; i++) b.push([0, 0, 0, 0]);
    return b;
  }
  function clone(b) { return b.map(function (r) { return r.slice(); }); }
  function emptyCells(b) {
    var out = [];
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) if (b[r][c] === 0) out.push([r, c]);
    return out;
  }
  function forEach(b, fn) { for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) fn(b[r][c], r, c); }
  function maxVal(b) { var m = 0; forEach(b, function (v) { if (v > m) m = v; }); return m; }
  function k(r, c) { return r + "," + c; }

  // dir: 0 up,1 right,2 down,3 left
  function tryMove(board, dir) {
    var b = clone(board), gained = 0, moved = false;
    var axis = (dir === 0 || dir === 2) ? 1 : 0;
    var forward = (dir === 1 || dir === 2) ? -1 : 1;
    for (var lane = 0; lane < 4; lane++) {
      var vals = [];
      for (var i = 0; i < 4; i++) {
        var rr = axis === 0 ? lane : (forward === 1 ? i : 3 - i);
        var cc = axis === 0 ? (forward === 1 ? i : 3 - i) : lane;
        vals.push(b[rr][cc]);
      }
      var res = slideMerge(vals);
      if (res.moved) moved = true;
      gained += res.gained;
      for (var j = 0; j < 4; j++) {
        var rr2 = axis === 0 ? lane : (forward === 1 ? j : 3 - j);
        var cc2 = axis === 0 ? (forward === 1 ? j : 3 - j) : lane;
        b[rr2][cc2] = res.line[j];
      }
    }
    return { board: b, gained: gained, moved: moved };
  }
  function slideMerge(vals) {
    var nz = vals.filter(function (v) { return v !== 0; });
    var out = [], moved = nz.length !== vals.length, gained = 0;
    for (var i = 0; i < nz.length; i++) {
      if (i + 1 < nz.length && nz[i] === nz[i + 1]) { out.push(nz[i] * 2); gained += nz[i] * 2; i++; moved = true; }
      else out.push(nz[i]);
    }
    while (out.length < 4) out.push(0);
    return { line: out, gained: gained, moved: moved };
  }
  function deadOr(b) {
    if (emptyCells(b).length) return false;
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var v = b[r][c];
      if (c + 1 < 4 && b[r][c + 1] === v) return false;
      if (r + 1 < 4 && b[r + 1][c] === v) return false;
    }
    return true;
  }

  function SeedGame() {
    this.board = emptyBoard();
    this.seeds = {};      // 本回合刚播下、仍为 2 的种子坐标集
    this.score = 0;
    this.best = parseInt(localStorage.getItem("seed-best") || "0", 10);
    this.stall = 0;       // 连续合体停歇的步数
    this.won = false; this.over = false; this.keep = false;

    this.elBoard = document.getElementById("board-seed");
    this.elScore = document.getElementById("seed-score");
    this.elBest = document.getElementById("seed-best");
    this.elMsg = document.getElementById("seed-msg");
    this.elSeason = document.getElementById("season-marker");

    this.plant(); this.plant();         // 开局两粒种子
    this.render();
    this.bind();
  }

  // 播种
  SeedGame.prototype.plant = function () {
    var cells = emptyCells(this.board);
    if (!cells.length) return false;
    var p = cells[Math.floor(Math.random() * cells.length)];
    this.board[p[0]][p[1]] = 2;
    this.seeds[k(p[0], p[1])] = true;
    return true;
  };

  // 成熟：上回合留下的种子从 2 长成 4
  SeedGame.prototype.mature = function () {
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var key = k(r, c);
      var ripened = this.seeds[key];
      if (this.board[r][c] === 2 && ripened) {
        this.board[r][c] = 4;
        delete this.seeds[key];
      }
    }
    this.seeds = {};
  };

  SeedGame.prototype.move = function (dir) {
    if (this.over || (this.won && !this.keep)) return;
    var res = tryMove(this.board, dir);
    if (!res.moved) return;
    this.board = res.board;
    this.score += res.gained;
    if (res.gained > 0) this.stall = 0; else this.stall++;

    // 春天：久不合体，额外发芽
    var extra = (this.stall > 0 && this.stall % STALL_SPROUT === 0);

    this.mature();      // 老种子先熟成 4
    this.plant();       // 新种一粒种子
    if (extra) this.plant(); // 春风吹又生

    this.secondChance(); // 若错过，仍可能合体；这里做最终判定
    this.save();
    if (window.nudge) window.nudge(this.elBoard, dir); // 滑动跟随的推力
    this.render();
    this.announce();
  };

  // 更新胜负状态
  SeedGame.prototype.secondChance = function () {
    if (maxVal(this.board) >= WIN_VAL && !this.won) this.won = true;
    if (!this.movable()) this.over = true;
  };
  SeedGame.prototype.movable = function () {
    if (emptyCells(this.board).length) return true;
    for (var d = 0; d < 4; d++) if (tryMove(this.board, d).moved) return true;
    return false;
  };

  SeedGame.prototype.save = function () {
    if (this.score > this.best) this.best = this.score;
    localStorage.setItem("seed-best", String(this.best));
  };

  SeedGame.prototype.announce = function () {
    if (this.over) this.say("秋尽收获已尽，棋盘枯荣", false);
    else if (this.won && !this.keep) this.say('结出硕果 <b>2048</b>！<button class="sd-act" data-a="keep">再养</button><button class="sd-act" data-a="new">新芽</button>', true);
    else if (this.elMsg) this.elMsg.style.display = "none";
  };
  SeedGame.prototype.say = function (html, actions) {
    this.elMsg.innerHTML = html;
    this.elMsg.style.display = "block";
    var self = this;
    if (actions) this.elMsg.querySelectorAll("[data-a]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("data-a") === "keep") self.keep = true;
        self.restart();
      });
    });
  };

  SeedGame.prototype.restart = function () {
    this.board = emptyBoard(); this.score = 0; this.won = false; this.over = false; this.keep = false; this.stall = 0;
    this.plant(); this.plant();
    this.render();
    if (this.elMsg) this.elMsg.style.display = "none";
  };

  SeedGame.prototype.render = function () {
    this.elScore.textContent = this.score;
    this.elBest.textContent = this.best;
    this.seasonDots();
    this.elBoard.innerHTML = "";
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var cell = document.createElement("div");
      cell.className = "bcell";
      var v = this.board[r][c];
      if (v) {
        cell.textContent = v;
        cell.className += " t" + v;
        if (v === 2 && this.seeds[k(r, c)]) cell.className += " seed";
        if (v >= 2048) cell.className += " harvest";
      }
      this.elBoard.appendChild(cell);
    }
  };

  SeedGame.prototype.seasonDots = function () {
    var el = this.elSeason;
    if (!el) return;
    var n = this.stall % STALL_SPROUT;
    el.innerHTML = "";
    for (var i = 0; i < STALL_SPROUT; i++) {
      var d = document.createElement("i");
      d.className = i < n ? "hot" : "";
      el.appendChild(d);
    }
  };

  SeedGame.prototype.bind = function () {
    var KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
    var self = this;
    window.addEventListener("keydown", function (e) {
      var d = KEYS[e.code];
      if (d === undefined) return;
      e.preventDefault();
      self.move(d);
    });
    // 手机滑动：右/左/下/上 → 1/3/2/0
    if (window.bindSwipe) window.bindSwipe(this.elBoard, function (d) { self.move(d); });
  };

  window.SeedGame = function () { return new SeedGame(); };
})();