/* =============================================================
   发射 LAUNCH · “射箭上盘”
   从下方把方块打上棋盘：选一张“牌” → 选一列发射。
   方块落位后按经典规则向下合并（同数相撞翻倍）。
   合成 2048 即抵达顶点；某一列被顶满（整盘满格）则告负。
   ============================================================= */
(function () {
  "use strict";

  var COLS = 4;
  var ROWS = 5;      // 棋盘高度（自顶向下 0..4，方块落到底部）
  var WIN_VAL = 2048;

  function emptyBoard() {
    var b = [];
    for (var r = 0; r < ROWS; r++) b.push([0, 0, 0, 0]);
    return b;
  }
  function emptyCells(b) {
    var o = [];
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (!b[r][c]) o.push([r, c]);
    return o;
  }
  // 某一列从底到顶的非零值（重力朝下 → 底在下）
  function colStack(b, col) {
    var s = [];
    for (var r = ROWS - 1; r >= 0; r--) if (b[r][col]) s.push(b[r][col]);
    return s;
  }
  // 经典合并：向底部坍缩，相邻同数合并一次
  function collapse(s) {
    var out = [], gained = 0, merges = 0;
    for (var i = 0; i < s.length; i++) {
      if (i + 1 < s.length && s[i] === s[i + 1]) { out.push(s[i] * 2); gained += s[i] * 2; merges++; i++; }
      else out.push(s[i]);
    }
    return { out: out, gained: gained, merges: merges };
  }
  function maxVal(b) {
    var m = 0;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (b[r][c] > m) m = b[r][c];
    return m;
  }
  function columnFull(b, col) { return colStack(b, col).length >= ROWS; }
  function allFull(b) {
    for (var c = 0; c < COLS; c++) if (!columnFull(b, c)) return false;
    return true;
  }
  // 候选牌（多为 2，偶有 4）
  function genTray() {
    var t = [];
    for (var i = 0; i < 3; i++) t.push(Math.random() < 0.72 ? 2 : 4);
    return t;
  }

  function LaunchGame() {
    this.board = emptyBoard();
    this.score = 0;
    this.best = parseInt(window.localStorage.getItem("launch-best") || "0", 10);
    this.won = false; this.over = false;
    this.armed = -1;          // 当前选中的牌下标
    this.tray = genTray();
    this.next = genTray();    // 预告下一组

    this.elBoard = document.getElementById("board-launch");
    this.elScore = document.getElementById("launch-score");
    this.elBest  = document.getElementById("launch-best");
    this.elMsg   = document.getElementById("launch-msg");
    this.elCombo = document.getElementById("launch-combo");

    this.seed();
    this.renderTray();
    this.render();
    this.bind();
  }

  LaunchGame.prototype.seed = function () {
    var e = emptyCells(this.board);
    if (e.length) { var p = e.splice(Math.floor(Math.random() * e.length), 1)[0]; this.board[p[0]][p[1]] = 2; }
    e = emptyCells(this.board);
    if (e.length) { var q = e.splice(Math.floor(Math.random() * e.length), 1)[0]; this.board[q[0]][q[1]] = Math.random() < 0.9 ? 2 : 4; }
  };

  // 发射选中的牌到指定列
  LaunchGame.prototype.launch = function (col) {
    if (this.over || this.armed < 0) return;
    if (columnFull(this.board, col)) return;
    var val = this.tray[this.armed];
    var s = colStack(this.board, col);
    s.push(val);
    var res = collapse(s);

    for (var r = 0; r < ROWS; r++) this.board[r][col] = 0;
    for (var k = 0; k < res.out.length; k++) this.board[ROWS - 1 - k][col] = res.out[k];

    this.score += res.gained;
    if (res.merges >= 2) this.flashCombo(res.merges);

    // 旧牌作废，下一组登场
    this.tray = this.next; this.next = genTray();
    this.armed = -1;
    this.renderTray();

    this.checkState();
    this.render();
  };

  LaunchGame.prototype.flashCombo = function (n) {
    if (!this.elCombo) return;
    this.elCombo.textContent = "×" + n + " 连击";
    this.elCombo.classList.remove("on");
    void this.elCombo.offsetWidth;
    this.elCombo.classList.add("on");
  };

  LaunchGame.prototype.checkState = function () {
    if (maxVal(this.board) >= WIN_VAL && !this.won) this.won = true;
    if (allFull(this.board)) this.over = true;
    if (this.score > this.best) { this.best = this.score; window.localStorage.setItem("launch-best", String(this.best)); }
    this.announce();
  };

  LaunchGame.prototype.announce = function () {
    if (this.over) this.say("棋盘已满 · 得分 " + this.score, false);
    else if (this.won) this.say('合出 <b>2048</b>！可继续发射冲更高', true);
    else if (this.elMsg) this.elMsg.style.display = "none";
  };
  LaunchGame.prototype.say = function (html, acts) {
    this.elMsg.innerHTML = "<div>" + html + "</div>" + (acts ? "" : "") +
      '<button class="l-act" data-a="new">再来一发</button>';
    this.elMsg.style.display = "block";
    var self = this;
    var b = this.elMsg.querySelector("[data-a]");
    if (b) b.addEventListener("click", function () { self.restart(); });
  };

  LaunchGame.prototype.restart = function () {
    this.board = emptyBoard(); this.score = 0; this.won = false; this.over = false; this.armed = -1;
    this.tray = genTray(); this.next = genTray();
    if (this.elCombo) this.elCombo.classList.remove("on");
    this.seed(); this.renderTray(); this.render();
    if (this.elMsg) this.elMsg.style.display = "none";
  };

  // ---------- 渲染 ----------
  LaunchGame.prototype.renderTray = function () {
    var wrap = document.getElementById("tray-launch");
    if (wrap) {
      var h = "";
      for (var i = 0; i < 3; i++) {
        h += '<span class="pick' + (i === this.armed ? " on" : "") + '" data-i="' + i + '">' + this.tray[i] + '</span>';
      }
      wrap.innerHTML = h;
      var self = this;
      wrap.querySelectorAll(".pick").forEach(function (el) {
        el.addEventListener("click", function () {
          self.armed = parseInt(el.getAttribute("data-i"), 10);
          self.renderTray();
        });
      });
    }
    var nw = document.getElementById("next-launch");
    if (nw) nw.innerHTML = this.next.join(" · ");
  };

  LaunchGame.prototype.render = function () {
    this.elScore.textContent = this.score;
    this.elBest.textContent = this.best;
    var h = "";
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var v = this.board[r][c];
      h += '<span class="lcell' + (v ? " t" + v : "") + (v >= WIN_VAL ? " star" : "") + '">' + (v || "") + '</span>';
    }
    this.elBoard.innerHTML = h;
  };

  // ---------- 操作 ----------
  LaunchGame.prototype.bind = function () {
    var self = this;

    // 列发射条：点某列发射
    var cols = document.getElementById("cols-launch");
    if (cols) {
      cols.querySelectorAll("[data-col]").forEach(function (el) {
        el.addEventListener("click", function () { self.launch(parseInt(el.getAttribute("data-col"), 10)); });
      });
    }

    // 键盘：1/2/3 选牌，Q/W/E/R 发射到 1..4 列，空格发射到最安全列
    window.addEventListener("keydown", function (e) {
      if (e.code === "Digit1") { self.armed = 0; self.renderTray(); e.preventDefault(); return; }
      if (e.code === "Digit2") { self.armed = 1; self.renderTray(); e.preventDefault(); return; }
      if (e.code === "Digit3") { self.armed = 2; self.renderTray(); e.preventDefault(); return; }
      if (e.code === "KeyQ") { self.launch(0); e.preventDefault(); return; }
      if (e.code === "KeyW") { self.launch(1); e.preventDefault(); return; }
      if (e.code === "KeyE") { self.launch(2); e.preventDefault(); return; }
      if (e.code === "KeyR") { self.launch(3); e.preventDefault(); return; }
      if (e.code === "Space") {
        e.preventDefault();
        if (self.armed >= 0) {
          // 挑空位最多的一列
          var bestC = 0, best = -1;
          for (var c = 0; c < COLS; c++) {
            var f = ROWS - colStack(self.board, c).length;
            if (f > best) { best = f; bestC = c; }
          }
          self.launch(bestC);
        }
      }
    });

    var restartBtn = document.getElementById("launch-restart");
    if (restartBtn) restartBtn.addEventListener("click", function () { self.restart(); });
  };

  window.LaunchGame = LaunchGame;
})();